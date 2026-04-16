-- ==========================================================
-- Buchat — Sprint 2 : messages éphémères, réactions, accusés,
-- multi-device, groupes, archivage/épinglage, recherche
-- ==========================================================
-- Migration : 002_sprint2.sql
--
-- IMPORTANT — souveraineté : les messages sont stockés avec un
-- TTL (30 jours par défaut, configurable) pour permettre la
-- synchronisation multi-appareils et la recherche. Un job de
-- purge tourne régulièrement pour effacer les anciens messages
-- (fonction purge_old_messages()).
--
-- Toutes les ajouts ici se font IF NOT EXISTS pour rester
-- idempotents.
-- ==========================================================

-- ---------- MESSAGES (historique éphémère) ----------
-- Utilisé pour :
--   • Synchroniser l'historique entre appareils (multi-device)
--   • Permettre la recherche full-text
--   • Accuser réception / lecture
--   • File offline si Redis est en panne (fallback)
--
-- NE PAS stocker les médias : le content d'un message média
-- contient seulement l'URL présignée MinIO.
CREATE TABLE IF NOT EXISTS messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id      UUID REFERENCES users(id) ON DELETE CASCADE,   -- null si group message
    group_id        UUID,                                           -- FK sur groups définie plus bas
    content         TEXT,                                           -- texte ou URL média
    type            TEXT NOT NULL DEFAULT 'text',                   -- text|image|video|audio|voice|file
    media_bucket    TEXT,                                           -- bucket MinIO (si média)
    media_object    TEXT,                                           -- object name (si média)
    reply_to        UUID REFERENCES messages(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at       TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,                                    -- soft-delete (tombstone)
    CHECK ((to_user_id IS NOT NULL) OR (group_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_messages_direct
    ON messages(from_user_id, to_user_id, created_at DESC)
    WHERE to_user_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_received
    ON messages(to_user_id, created_at DESC)
    WHERE to_user_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_group
    ON messages(group_id, created_at DESC)
    WHERE group_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_created
    ON messages(created_at);

-- Recherche full-text (français + anglais). Pour le Kirundi, on
-- utilise 'simple' qui tokenise sans stopwords spécifiques à une
-- langue — l'utilisateur trouve les mots exacts même en Kirundi.
CREATE INDEX IF NOT EXISTS idx_messages_content_fts
    ON messages USING GIN (to_tsvector('simple', COALESCE(content, '')));

-- ---------- READ RECEIPTS ----------
-- Un récepteur par (message, user). status = delivered puis read.
CREATE TABLE IF NOT EXISTS message_receipts (
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          TEXT NOT NULL,          -- 'delivered' | 'read'
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_receipts_user ON message_receipts(user_id, updated_at DESC);

-- ---------- REACTIONS ----------
-- Un utilisateur = une seule réaction par message (à la WhatsApp).
CREATE TABLE IF NOT EXISTS message_reactions (
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji           TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);

-- ---------- DEVICES (multi-appareils) ----------
-- Chaque connexion Socket.IO est un device. Un user peut en avoir
-- plusieurs simultanément (PWA iPhone + Desktop + Android).
CREATE TABLE IF NOT EXISTS devices (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT,                      -- 'iPhone de Fiston'
    platform        TEXT,                      -- 'web'|'ios'|'android'|'desktop'
    user_agent      TEXT,
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id, last_seen_at DESC);

-- ---------- GROUPS ----------
CREATE TABLE IF NOT EXISTS groups (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    about           TEXT,
    avatar_url      TEXT,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

-- FK différée sur messages.group_id (le check `CHECK` dans la
-- colonne messages.group_id est fonctionnel, on ajoute la FK
-- réelle après création de groups).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'messages_group_id_fkey'
    ) THEN
        ALTER TABLE messages
            ADD CONSTRAINT messages_group_id_fkey
            FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS group_members (
    group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            TEXT NOT NULL DEFAULT 'member',  -- 'admin' | 'member'
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_user  ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);

-- ---------- CHAT SETTINGS (archive + pin + mute) ----------
-- Une ligne par (user, chat) avec chat = peer_id ou group_id.
CREATE TABLE IF NOT EXISTS chat_settings (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    peer_id         UUID,                      -- autre user (chat direct)
    group_id        UUID REFERENCES groups(id) ON DELETE CASCADE,
    pinned_at       TIMESTAMPTZ,
    archived_at     TIMESTAMPTZ,
    muted_until     TIMESTAMPTZ,               -- NULL = pas en mute
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((peer_id IS NOT NULL) OR (group_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_settings_direct
    ON chat_settings(user_id, peer_id)
    WHERE peer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_settings_group
    ON chat_settings(user_id, group_id)
    WHERE group_id IS NOT NULL;

-- ---------- PURGE FUNCTION ----------
-- Supprime les messages plus vieux que N jours (défaut 30).
CREATE OR REPLACE FUNCTION purge_old_messages(days_to_keep INT DEFAULT 30)
RETURNS INT AS $$
DECLARE
    deleted INT;
BEGIN
    WITH del AS (
        DELETE FROM messages
        WHERE created_at < NOW() - (days_to_keep || ' days')::INTERVAL
        RETURNING 1
    )
    SELECT COUNT(*) INTO deleted FROM del;
    RETURN deleted;
END;
$$ LANGUAGE plpgsql;

-- ---------- VERSION ----------
INSERT INTO schema_migrations (version) VALUES (2) ON CONFLICT DO NOTHING;
