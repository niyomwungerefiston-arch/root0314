/**
 * Buchat — Chat settings (Sprint 2)
 *
 * Gère, par utilisateur :
 *   • archivage d'un chat (direct ou groupe)
 *   • épinglage
 *   • mute temporaire
 *   • blocage d'un user (table blocked_users)
 */

const db = require('./db');

function hydrateSettings(rows) {
  return rows.map((r) => ({
    peerId: r.peer_id,
    groupId: r.group_id,
    pinnedAt: r.pinned_at,
    archivedAt: r.archived_at,
    mutedUntil: r.muted_until,
  }));
}

async function list(userId) {
  const { rows } = await db.query(
    `SELECT peer_id, group_id, pinned_at, archived_at, muted_until
       FROM chat_settings
      WHERE user_id = $1
        AND (pinned_at IS NOT NULL OR archived_at IS NOT NULL OR muted_until IS NOT NULL)`,
    [userId]
  );
  return hydrateSettings(rows);
}

async function upsert(userId, { peerId = null, groupId = null }, patch = {}) {
  if (!peerId && !groupId) throw new Error('peerId ou groupId requis');

  const keyCol = peerId ? 'peer_id' : 'group_id';
  const keyVal = peerId || groupId;

  // Check existing row
  const { rows: existing } = await db.query(
    `SELECT 1 FROM chat_settings
      WHERE user_id = $1 AND ${keyCol} = $2`,
    [userId, keyVal]
  );

  const sets = [];
  const vals = [];
  let i = 1;
  if (patch.pinnedAt !== undefined) { sets.push(`pinned_at = $${i++}`); vals.push(patch.pinnedAt); }
  if (patch.archivedAt !== undefined) { sets.push(`archived_at = $${i++}`); vals.push(patch.archivedAt); }
  if (patch.mutedUntil !== undefined) { sets.push(`muted_until = $${i++}`); vals.push(patch.mutedUntil); }
  if (sets.length === 0) return null;

  sets.push('updated_at = NOW()');

  if (existing.length > 0) {
    vals.push(userId, keyVal);
    await db.query(
      `UPDATE chat_settings SET ${sets.join(', ')}
        WHERE user_id = $${i++} AND ${keyCol} = $${i}`,
      vals
    );
  } else {
    // INSERT
    const cols = ['user_id', keyCol];
    const placeholders = ['$1', '$2'];
    const insertVals = [userId, keyVal];
    let idx = 3;
    if (patch.pinnedAt !== undefined) { cols.push('pinned_at'); placeholders.push(`$${idx++}`); insertVals.push(patch.pinnedAt); }
    if (patch.archivedAt !== undefined) { cols.push('archived_at'); placeholders.push(`$${idx++}`); insertVals.push(patch.archivedAt); }
    if (patch.mutedUntil !== undefined) { cols.push('muted_until'); placeholders.push(`$${idx++}`); insertVals.push(patch.mutedUntil); }

    await db.query(
      `INSERT INTO chat_settings (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
      insertVals
    );
  }
  return true;
}

async function pin(userId, target) {
  await upsert(userId, target, { pinnedAt: new Date() });
}
async function unpin(userId, target) {
  await upsert(userId, target, { pinnedAt: null });
}
async function archive(userId, target) {
  await upsert(userId, target, { archivedAt: new Date() });
}
async function unarchive(userId, target) {
  await upsert(userId, target, { archivedAt: null });
}
async function mute(userId, target, hours = 8) {
  const until = new Date(Date.now() + hours * 3600 * 1000);
  await upsert(userId, target, { mutedUntil: until });
}
async function unmute(userId, target) {
  await upsert(userId, target, { mutedUntil: null });
}

// --------- Blocked users ---------

async function block(userId, blockedId, reason = null) {
  if (userId === blockedId) throw new Error('Impossible de se bloquer soi-même');
  await db.query(
    `INSERT INTO blocked_users (user_id, blocked_id, reason)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [userId, blockedId, reason]
  );
}

async function unblock(userId, blockedId) {
  await db.query(
    `DELETE FROM blocked_users WHERE user_id = $1 AND blocked_id = $2`,
    [userId, blockedId]
  );
}

async function listBlocked(userId) {
  const { rows } = await db.query(
    `SELECT b.blocked_id, b.reason, b.created_at,
            u.display_name, u.phone, u.avatar_url
       FROM blocked_users b
       JOIN users u ON u.id = b.blocked_id
      WHERE b.user_id = $1
      ORDER BY b.created_at DESC`,
    [userId]
  );
  return rows.map((r) => ({
    userId: r.blocked_id,
    displayName: r.display_name,
    phone: r.phone,
    avatarUrl: r.avatar_url,
    reason: r.reason,
    createdAt: r.created_at,
  }));
}

/**
 * Renvoie true si userA a bloqué userB OU userB a bloqué userA.
 */
async function isBlockedEither(userA, userB) {
  const { rows } = await db.query(
    `SELECT 1 FROM blocked_users
      WHERE (user_id = $1 AND blocked_id = $2)
         OR (user_id = $2 AND blocked_id = $1)
      LIMIT 1`,
    [userA, userB]
  );
  return rows.length > 0;
}

module.exports = {
  list,
  pin,
  unpin,
  archive,
  unarchive,
  mute,
  unmute,
  block,
  unblock,
  listBlocked,
  isBlockedEither,
};
