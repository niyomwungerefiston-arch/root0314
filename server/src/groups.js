/**
 * Buchat — Groupes (Sprint 2)
 *
 * Remplace l'implémentation in-memory précédente.
 * Tables : groups, group_members.
 */

const db = require('./db');

const MAX_GROUP_SIZE = parseInt(process.env.BUCHAT_MAX_GROUP_SIZE || '256', 10);

function hydrateGroup(row, members = []) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    about: row.about,
    avatarUrl: row.avatar_url,
    createdBy: row.created_by,
    createdAt: row.created_at,
    members,
  };
}

async function create(creatorId, { name, members = [], about = null }) {
  name = (name || '').trim();
  if (!name) throw new Error('Nom du groupe requis');
  if (name.length > 80) throw new Error('Nom trop long (80 max)');

  const uniqueMembers = Array.from(
    new Set([creatorId, ...members.filter((m) => m && m !== creatorId)])
  );
  if (uniqueMembers.length > MAX_GROUP_SIZE) {
    throw new Error(`Groupe trop grand (max ${MAX_GROUP_SIZE})`);
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO groups (name, about, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, name, about, avatar_url, created_by, created_at`,
      [name, about, creatorId]
    );
    const group = rows[0];

    const memberRows = uniqueMembers.map((uid) => [
      group.id,
      uid,
      uid === creatorId ? 'admin' : 'member',
    ]);
    const placeholders = memberRows
      .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
      .join(', ');
    const flat = memberRows.flat();
    await client.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ${placeholders}`,
      flat
    );

    await client.query('COMMIT');
    return hydrateGroup(group, uniqueMembers);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listForUser(userId) {
  const { rows } = await db.query(
    `SELECT g.id, g.name, g.about, g.avatar_url, g.created_by, g.created_at,
            ARRAY(
              SELECT user_id FROM group_members WHERE group_id = g.id
            ) AS members
       FROM groups g
       JOIN group_members m ON m.group_id = g.id
      WHERE m.user_id = $1 AND g.is_active = TRUE
      ORDER BY g.created_at DESC`,
    [userId]
  );
  return rows.map((r) => hydrateGroup(r, r.members));
}

async function get(groupId, userId) {
  const { rows } = await db.query(
    `SELECT g.id, g.name, g.about, g.avatar_url, g.created_by, g.created_at,
            ARRAY(
              SELECT user_id FROM group_members WHERE group_id = g.id
            ) AS members
       FROM groups g
       JOIN group_members m ON m.group_id = g.id
      WHERE g.id = $1 AND m.user_id = $2 AND g.is_active = TRUE`,
    [groupId, userId]
  );
  return rows[0] ? hydrateGroup(rows[0], rows[0].members) : null;
}

async function getMembers(groupId) {
  const { rows } = await db.query(
    'SELECT user_id FROM group_members WHERE group_id = $1',
    [groupId]
  );
  return rows.map((r) => r.user_id);
}

async function isMember(groupId, userId) {
  const { rows } = await db.query(
    'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );
  return rows.length > 0;
}

async function addMember(groupId, adderId, newUserId) {
  // adderId doit être admin du groupe
  const { rows } = await db.query(
    `SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, adderId]
  );
  if (rows.length === 0 || rows[0].role !== 'admin') {
    throw new Error('Seuls les admins peuvent ajouter des membres');
  }
  await db.query(
    `INSERT INTO group_members (group_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [groupId, newUserId]
  );
  return get(groupId, adderId);
}

async function removeMember(groupId, removerId, targetUserId) {
  if (removerId !== targetUserId) {
    // vérifier admin
    const { rows } = await db.query(
      `SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [groupId, removerId]
    );
    if (rows.length === 0 || rows[0].role !== 'admin') {
      throw new Error('Seuls les admins peuvent retirer des membres');
    }
  }
  await db.query(
    `DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, targetUserId]
  );
  return true;
}

async function update(groupId, userId, { name, about, avatarUrl }) {
  const { rows: roleRows } = await db.query(
    `SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId]
  );
  if (roleRows.length === 0 || roleRows[0].role !== 'admin') {
    throw new Error('Seuls les admins peuvent modifier le groupe');
  }

  const sets = [];
  const vals = [];
  let i = 1;
  if (name !== undefined) { sets.push(`name = $${i++}`); vals.push(name); }
  if (about !== undefined) { sets.push(`about = $${i++}`); vals.push(about); }
  if (avatarUrl !== undefined) { sets.push(`avatar_url = $${i++}`); vals.push(avatarUrl); }
  if (sets.length === 0) return get(groupId, userId);

  vals.push(groupId);
  await db.query(
    `UPDATE groups SET ${sets.join(', ')} WHERE id = $${i}`,
    vals
  );
  return get(groupId, userId);
}

module.exports = {
  create,
  listForUser,
  get,
  getMembers,
  isMember,
  addMember,
  removeMember,
  update,
  MAX_GROUP_SIZE,
};
