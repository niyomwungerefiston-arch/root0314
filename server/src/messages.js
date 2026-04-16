/**
 * Buchat — Module messages (Sprint 2)
 *
 * Gère la persistance éphémère des messages (TTL configurable,
 * défaut 30 jours) pour permettre :
 *   • synchronisation multi-appareils
 *   • accusés de réception ✓✓
 *   • réactions emoji
 *   • recherche full-text
 *
 * Les médias sont référencés (bucket + object MinIO) mais jamais
 * inlines dans le champ content pour ne pas saturer PostgreSQL.
 */

const db = require('./db');

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;
const MESSAGE_TTL_DAYS = parseInt(process.env.MESSAGE_TTL_DAYS || '30', 10);

// -------------------- Persistence --------------------

/**
 * Insère un message direct (1-à-1) ou groupe.
 * payload :
 *   { fromUserId, toUserId?, groupId?, content, type,
 *     mediaBucket?, mediaObject?, replyTo? }
 */
async function save(payload) {
  const {
    fromUserId,
    toUserId = null,
    groupId = null,
    content = null,
    type = 'text',
    mediaBucket = null,
    mediaObject = null,
    replyTo = null,
  } = payload;

  const { rows } = await db.query(
    `INSERT INTO messages
       (from_user_id, to_user_id, group_id, content, type,
        media_bucket, media_object, reply_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, from_user_id, to_user_id, group_id, content,
               type, media_bucket, media_object, reply_to,
               created_at`,
    [fromUserId, toUserId, groupId, content, type,
     mediaBucket, mediaObject, replyTo]
  );
  return hydrate(rows[0]);
}

/**
 * Renvoie l'historique d'une conversation directe entre 2 users
 * (dans les 2 sens), du plus récent au plus ancien, enrichi avec
 * les réactions + receipts.
 */
async function getDirectHistory(userId, peerId, { limit = DEFAULT_HISTORY_LIMIT, before = null } = {}) {
  limit = Math.min(MAX_HISTORY_LIMIT, Math.max(1, parseInt(limit, 10) || DEFAULT_HISTORY_LIMIT));

  const params = [userId, peerId];
  let beforeClause = '';
  if (before) {
    params.push(new Date(before));
    beforeClause = `AND created_at < $${params.length}`;
  }
  params.push(limit);

  const { rows } = await db.query(
    `SELECT id, from_user_id, to_user_id, group_id, content, type,
            media_bucket, media_object, reply_to, created_at, edited_at
       FROM messages
      WHERE deleted_at IS NULL
        AND (
          (from_user_id = $1 AND to_user_id = $2)
          OR (from_user_id = $2 AND to_user_id = $1)
        )
        ${beforeClause}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params
  );

  return enrich(rows.map(hydrate));
}

/**
 * Historique d'un groupe.
 */
async function getGroupHistory(userId, groupId, { limit = DEFAULT_HISTORY_LIMIT, before = null } = {}) {
  // Vérifier que l'user est membre
  const { rows: membership } = await db.query(
    'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );
  if (membership.length === 0) {
    throw new Error('Accès refusé au groupe');
  }

  limit = Math.min(MAX_HISTORY_LIMIT, Math.max(1, parseInt(limit, 10) || DEFAULT_HISTORY_LIMIT));

  const params = [groupId];
  let beforeClause = '';
  if (before) {
    params.push(new Date(before));
    beforeClause = `AND created_at < $${params.length}`;
  }
  params.push(limit);

  const { rows } = await db.query(
    `SELECT id, from_user_id, to_user_id, group_id, content, type,
            media_bucket, media_object, reply_to, created_at, edited_at
       FROM messages
      WHERE deleted_at IS NULL
        AND group_id = $1
        ${beforeClause}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params
  );

  return enrich(rows.map(hydrate));
}

// -------------------- Receipts --------------------

/**
 * Marque le message comme "delivered" pour un destinataire.
 * Idempotent : upgrade delivered → read possible, pas l'inverse.
 */
async function markDelivered(messageId, userId) {
  await db.query(
    `INSERT INTO message_receipts (message_id, user_id, status, updated_at)
     VALUES ($1, $2, 'delivered', NOW())
     ON CONFLICT (message_id, user_id) DO NOTHING`,
    [messageId, userId]
  );
}

/**
 * Marque un lot de messages comme "read" pour un user.
 * Renvoie la liste des (messageId, fromUserId) effectivement mis à jour
 * pour pouvoir broadcaster l'accusé à l'expéditeur.
 */
async function markReadBulk(messageIds, userId) {
  if (!Array.isArray(messageIds) || messageIds.length === 0) return [];

  const { rows } = await db.query(
    `WITH upserted AS (
        INSERT INTO message_receipts (message_id, user_id, status, updated_at)
        SELECT m.id, $2, 'read', NOW()
          FROM messages m
         WHERE m.id = ANY($1::uuid[])
           AND m.deleted_at IS NULL
        ON CONFLICT (message_id, user_id)
        DO UPDATE SET status = 'read', updated_at = NOW()
        WHERE message_receipts.status <> 'read'
        RETURNING message_id
     )
     SELECT u.message_id, m.from_user_id
       FROM upserted u
       JOIN messages m ON m.id = u.message_id`,
    [messageIds, userId]
  );

  return rows.map((r) => ({ messageId: r.message_id, fromUserId: r.from_user_id }));
}

/**
 * Marque tous les messages reçus par userId d'un peer comme "read".
 */
async function markConversationRead(userId, peerId) {
  const { rows } = await db.query(
    `WITH to_mark AS (
        SELECT id FROM messages
         WHERE from_user_id = $2
           AND to_user_id   = $1
           AND deleted_at IS NULL
           AND id NOT IN (
             SELECT message_id FROM message_receipts
              WHERE user_id = $1 AND status = 'read'
           )
     ),
     upserted AS (
        INSERT INTO message_receipts (message_id, user_id, status, updated_at)
        SELECT id, $1, 'read', NOW() FROM to_mark
        ON CONFLICT (message_id, user_id)
        DO UPDATE SET status = 'read', updated_at = NOW()
        RETURNING message_id
     )
     SELECT message_id FROM upserted`,
    [userId, peerId]
  );
  return rows.map((r) => r.message_id);
}

// -------------------- Reactions --------------------

/**
 * Pose (ou remplace) la réaction d'un user sur un message.
 * Retourne le message impacté (pour broadcast).
 */
async function react(messageId, userId, emoji) {
  if (!emoji || typeof emoji !== 'string' || emoji.length > 16) {
    throw new Error('Emoji invalide');
  }

  await db.query(
    `INSERT INTO message_reactions (message_id, user_id, emoji)
     VALUES ($1, $2, $3)
     ON CONFLICT (message_id, user_id)
     DO UPDATE SET emoji = EXCLUDED.emoji, created_at = NOW()`,
    [messageId, userId, emoji]
  );

  return getMessageTargets(messageId);
}

async function unreact(messageId, userId) {
  await db.query(
    'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2',
    [messageId, userId]
  );
  return getMessageTargets(messageId);
}

// -------------------- Search --------------------

/**
 * Recherche full-text dans les messages d'un user (envoyés + reçus).
 * q : texte à chercher. limit : défaut 50.
 */
async function search(userId, q, { limit = 50 } = {}) {
  q = (q || '').trim();
  if (q.length < 2) return [];
  limit = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

  const { rows } = await db.query(
    `SELECT id, from_user_id, to_user_id, group_id, content, type,
            created_at,
            ts_headline('simple', content, plainto_tsquery('simple', $2),
                       'StartSel=<b>,StopSel=</b>,MaxFragments=1,MaxWords=10') AS snippet
       FROM messages
      WHERE deleted_at IS NULL
        AND type = 'text'
        AND content IS NOT NULL
        AND to_tsvector('simple', content) @@ plainto_tsquery('simple', $2)
        AND (
          from_user_id = $1
          OR to_user_id   = $1
          OR group_id IN (SELECT group_id FROM group_members WHERE user_id = $1)
        )
      ORDER BY created_at DESC
      LIMIT $3`,
    [userId, q, limit]
  );

  return rows.map((r) => ({
    id: r.id,
    from: r.from_user_id,
    to: r.to_user_id,
    groupId: r.group_id,
    content: r.content,
    snippet: r.snippet,
    type: r.type,
    createdAt: r.created_at,
  }));
}

// -------------------- Helpers --------------------

/**
 * Cible de routage d'un message (pour savoir à qui broadcaster
 * une mise à jour de réaction/reçu).
 */
async function getMessageTargets(messageId) {
  const { rows } = await db.query(
    `SELECT m.id, m.from_user_id, m.to_user_id, m.group_id,
            ARRAY(
              SELECT user_id FROM group_members WHERE group_id = m.group_id
            ) AS members
       FROM messages m
      WHERE m.id = $1`,
    [messageId]
  );
  if (rows.length === 0) throw new Error('Message introuvable');
  return {
    messageId: rows[0].id,
    from: rows[0].from_user_id,
    to: rows[0].to_user_id,
    groupId: rows[0].group_id,
    members: rows[0].members || [],
  };
}

function hydrate(row) {
  if (!row) return null;
  return {
    id: row.id,
    from: row.from_user_id,
    to: row.to_user_id,
    groupId: row.group_id,
    content: row.content,
    type: row.type,
    mediaBucket: row.media_bucket,
    mediaObject: row.media_object,
    replyTo: row.reply_to,
    createdAt: row.created_at,
    editedAt: row.edited_at,
  };
}

/**
 * Enrichit une liste de messages avec leurs réactions + receipts
 * en un seul aller-retour SQL chacun.
 */
async function enrich(messages) {
  if (messages.length === 0) return [];
  const ids = messages.map((m) => m.id);

  const [{ rows: reacs }, { rows: recs }] = await Promise.all([
    db.query(
      `SELECT message_id, user_id, emoji
         FROM message_reactions
        WHERE message_id = ANY($1::uuid[])`,
      [ids]
    ),
    db.query(
      `SELECT message_id, user_id, status
         FROM message_receipts
        WHERE message_id = ANY($1::uuid[])`,
      [ids]
    ),
  ]);

  const reactByMsg = new Map();
  reacs.forEach((r) => {
    if (!reactByMsg.has(r.message_id)) reactByMsg.set(r.message_id, []);
    reactByMsg.get(r.message_id).push({ userId: r.user_id, emoji: r.emoji });
  });

  const recByMsg = new Map();
  recs.forEach((r) => {
    if (!recByMsg.has(r.message_id)) recByMsg.set(r.message_id, []);
    recByMsg.get(r.message_id).push({ userId: r.user_id, status: r.status });
  });

  return messages.map((m) => ({
    ...m,
    reactions: reactByMsg.get(m.id) || [],
    receipts: recByMsg.get(m.id) || [],
  }));
}

function messagePreview(type, content) {
  if (type === 'text') return String(content || '').slice(0, 80);
  if (type === 'voice' || type === 'audio') return '🎤 Message vocal';
  if (type === 'image') return '📷 Photo';
  if (type === 'video') return '🎬 Vidéo';
  if (type === 'file') return '📎 Fichier';
  return 'Nouveau message';
}

module.exports = {
  save,
  getDirectHistory,
  getGroupHistory,
  markDelivered,
  markReadBulk,
  markConversationRead,
  react,
  unreact,
  search,
  getMessageTargets,
  messagePreview,
  MESSAGE_TTL_DAYS,
};
