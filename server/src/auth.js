/**
 * Buchat — Authentification (PostgreSQL)
 *
 * Remplace l'ancien store in-memory Map par PostgreSQL.
 * Gère l'inscription, la connexion, la mise à jour du profil,
 * et les codes d'invitation optionnels.
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
const invites = require('./invites');

const JWT_SECRET = process.env.JWT_SECRET || 'buchat-secret-change-in-production';
const TOKEN_EXPIRY = '30d';
const INVITE_ONLY = process.env.BUCHAT_INVITE_ONLY === 'true';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);

// ------------------------- Helpers -------------------------

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    phone: row.phone,
    displayName: row.display_name,
    about: row.about,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, phone: user.phone, displayName: user.displayName || user.display_name },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// ------------------------- Register ------------------------

async function register(phone, password, displayName, inviteCode) {
  phone = (phone || '').trim();
  if (!phone || !password) {
    throw new Error('Numéro et mot de passe requis');
  }
  if (password.length < 6) {
    throw new Error('Mot de passe trop court (minimum 6 caractères)');
  }

  // Mode invite-only : code obligatoire sauf s'il n'y a encore aucun user
  let invitedById = null;
  if (INVITE_ONLY) {
    const { rows: countRows } = await db.query('SELECT COUNT(*)::int AS n FROM users');
    const userCount = countRows[0].n;

    // Le tout premier utilisateur (admin) s'inscrit sans code
    if (userCount > 0) {
      if (!inviteCode) {
        throw new Error("Un code d'invitation est requis");
      }
      const invite = await invites.consume(inviteCode);
      invitedById = invite.createdBy;
    }
  } else if (inviteCode) {
    // Mode ouvert mais si un code est fourni on l'utilise quand même
    try {
      const invite = await invites.consume(inviteCode);
      invitedById = invite.createdBy;
    } catch {
      // On ignore silencieusement en mode ouvert
    }
  }

  // Vérifier l'unicité
  const { rows: existing } = await db.query(
    'SELECT id FROM users WHERE phone = $1',
    [phone]
  );
  if (existing.length > 0) {
    throw new Error('Ce numéro est déjà enregistré');
  }

  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const name = (displayName && displayName.trim()) || phone;

  const { rows } = await db.query(
    `INSERT INTO users (phone, password_hash, display_name, invited_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, phone, display_name, about, avatar_url, created_at, last_seen_at`,
    [phone, hashed, name, invitedById]
  );

  const user = publicUser(rows[0]);
  return { token: generateToken(user), user };
}

// ------------------------- Login ---------------------------

async function login(phone, password) {
  phone = (phone || '').trim();
  const { rows } = await db.query(
    `SELECT id, phone, password_hash, display_name, about, avatar_url, created_at, last_seen_at, is_active
     FROM users WHERE phone = $1`,
    [phone]
  );
  if (rows.length === 0) {
    throw new Error('Numéro non trouvé');
  }
  const row = rows[0];
  if (!row.is_active) {
    throw new Error('Compte désactivé');
  }

  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) {
    throw new Error('Mot de passe incorrect');
  }

  await db.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [row.id]);

  const user = publicUser(row);
  return { token: generateToken(user), user };
}

// ------------------------- Lookups -------------------------

async function getUserById(id) {
  const { rows } = await db.query(
    `SELECT id, phone, display_name, about, avatar_url, created_at, last_seen_at
     FROM users WHERE id = $1 AND is_active = TRUE`,
    [id]
  );
  return publicUser(rows[0]);
}

async function getUserByPhone(phone) {
  const { rows } = await db.query(
    `SELECT id, phone, display_name, about, avatar_url, created_at, last_seen_at
     FROM users WHERE phone = $1 AND is_active = TRUE`,
    [phone]
  );
  return publicUser(rows[0]);
}

async function getAllUsers(limit = 500) {
  const { rows } = await db.query(
    `SELECT id, phone, display_name, about, avatar_url, created_at, last_seen_at
     FROM users WHERE is_active = TRUE
     ORDER BY display_name ASC LIMIT $1`,
    [limit]
  );
  return rows.map(publicUser);
}

async function searchUsers(query, limit = 20) {
  const { rows } = await db.query(
    `SELECT id, phone, display_name, about, avatar_url, created_at, last_seen_at
     FROM users
     WHERE is_active = TRUE
       AND (phone ILIKE $1 OR display_name ILIKE $1)
     ORDER BY display_name ASC LIMIT $2`,
    [`%${query}%`, limit]
  );
  return rows.map(publicUser);
}

// ------------------------- Profile updates ------------------

async function updateProfile(userId, { displayName, about, avatarUrl }) {
  const fields = [];
  const values = [];
  let i = 1;

  if (displayName !== undefined) {
    fields.push(`display_name = $${i++}`);
    values.push(displayName);
  }
  if (about !== undefined) {
    fields.push(`about = $${i++}`);
    values.push(about);
  }
  if (avatarUrl !== undefined) {
    fields.push(`avatar_url = $${i++}`);
    values.push(avatarUrl);
  }

  if (fields.length === 0) return getUserById(userId);

  values.push(userId);
  const { rows } = await db.query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${i}
     RETURNING id, phone, display_name, about, avatar_url, created_at, last_seen_at`,
    values
  );
  return publicUser(rows[0]);
}

async function updateLastSeen(userId) {
  await db.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [userId]);
}

module.exports = {
  generateToken,
  verifyToken,
  register,
  login,
  getUserById,
  getUserByPhone,
  getAllUsers,
  searchUsers,
  updateProfile,
  updateLastSeen,
};
