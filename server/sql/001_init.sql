-- ==========================================================
-- Buchat — Schéma initial PostgreSQL
-- ==========================================================
-- Migration : 001_init.sql
-- Crée les tables pour : users, invites, push_subscriptions,
--   contacts, blocked_users.
--
-- Important : les MESSAGES ne sont PAS stockés en base — ils
-- ne font que transiter par Socket.IO / Redis (souveraineté
-- et confidentialité). Seules les méta-données des comptes
-- et des invitations sont persistées.
-- ==========================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";  -- case-insensitive text

-- ---------- USERS ----------
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone           CITEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    about           TEXT DEFAULT 'Disponible sur Buchat',
    avatar_url      TEXT,
    invited_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_users_phone        ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_created      ON users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_last_seen    ON users(last_seen_at DESC);

-- ---------- INVITES ----------
-- Codes d'invitation (mode fermé optionnel).
-- Si BUCHAT_INVITE_ONLY=true, un nouvel inscrit doit fournir
-- un code valide créé par un utilisateur existant.
CREATE TABLE IF NOT EXISTS invites (
    code            TEXT PRIMARY KEY,                         -- ex: 'BUCHAT-A3F2-K9LZ'
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    used_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    max_uses        INT NOT NULL DEFAULT 1,
    uses            INT NOT NULL DEFAULT 0,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    used_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_invites_created_by ON invites(created_by);

-- ---------- PUSH SUBSCRIPTIONS ----------
-- Un utilisateur peut avoir plusieurs appareils (PWA iPhone,
-- PWA Android, desktop Electron). On stocke l'endpoint +
-- clés pour envoyer des Web Push notifications.
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint        TEXT NOT NULL UNIQUE,
    p256dh          TEXT NOT NULL,
    auth            TEXT NOT NULL,
    user_agent      TEXT,
    platform        TEXT,  -- 'web', 'ios', 'android', 'desktop'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

-- ---------- CONTACTS ----------
-- Relation optionnelle : user_a a ajouté user_b à ses contacts.
-- Bidirectionnel non obligatoire (comme WhatsApp).
CREATE TABLE IF NOT EXISTS contacts (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname        TEXT,                  -- Surnom local (ex: "Maman")
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, contact_id),
    CHECK (user_id <> contact_id)
);

CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);

-- ---------- BLOCKED USERS ----------
CREATE TABLE IF NOT EXISTS blocked_users (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, blocked_id),
    CHECK (user_id <> blocked_id)
);

-- ---------- SESSIONS (optionnel — pour révocation JWT) ----------
CREATE TABLE IF NOT EXISTS sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_jti       TEXT UNIQUE NOT NULL,   -- JWT ID pour révocation
    user_agent      TEXT,
    ip              INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_jti    ON sessions(token_jti);

-- ---------- SCHEMA VERSION ----------
CREATE TABLE IF NOT EXISTS schema_migrations (
    version         INT PRIMARY KEY,
    applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO schema_migrations (version) VALUES (1) ON CONFLICT DO NOTHING;
