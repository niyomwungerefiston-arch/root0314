/**
 * Buchat — Codes d'invitation
 *
 * Utilisable en mode fermé (BUCHAT_INVITE_ONLY=true) ou comme
 * mécanisme viral en mode ouvert (tracking "invité par X").
 *
 * Format de code : BUCHAT-XXXX-XXXX (lisible, facile à dicter)
 */

const crypto = require('crypto');
const db = require('./db');

const CODE_PREFIX = 'BUCHAT';
const DEFAULT_EXPIRY_DAYS = 30;

function randomChunk() {
  // 4 caractères alphanumériques sans 0/O/1/I (lisibilité)
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = crypto.randomBytes(4);
  for (let i = 0; i < 4; i++) {
    s += charset[bytes[i] % charset.length];
  }
  return s;
}

function generateCode() {
  return `${CODE_PREFIX}-${randomChunk()}-${randomChunk()}`;
}

/**
 * Crée un nouveau code d'invitation pour `userId`.
 * options:
 *   maxUses     : nombre d'utilisations autorisées (défaut 1)
 *   expiryDays  : jours avant expiration (défaut 30, 0 = illimité)
 */
async function create(userId, { maxUses = 1, expiryDays = DEFAULT_EXPIRY_DAYS } = {}) {
  const code = generateCode();
  const expiresAt =
    expiryDays > 0
      ? new Date(Date.now() + expiryDays * 24 * 3600 * 1000)
      : null;

  const { rows } = await db.query(
    `INSERT INTO invites (code, created_by, max_uses, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING code, max_uses, expires_at, created_at`,
    [code, userId, maxUses, expiresAt]
  );
  return {
    code: rows[0].code,
    maxUses: rows[0].max_uses,
    expiresAt: rows[0].expires_at,
    createdAt: rows[0].created_at,
    uses: 0,
    shareUrl: `${process.env.BUCHAT_PUBLIC_URL || 'https://buchat.bujaonline.com'}/app/?invite=${rows[0].code}`,
  };
}

/**
 * Consomme un code : vérifie validité, incrémente le compteur.
 * Lève une erreur si code invalide/expiré/épuisé.
 * Retourne { createdBy, code } pour enregistrer invited_by.
 */
async function consume(code) {
  if (!code) throw new Error("Code d'invitation manquant");
  code = code.trim().toUpperCase();

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT code, created_by, max_uses, uses, expires_at
       FROM invites WHERE code = $1 FOR UPDATE`,
      [code]
    );
    if (rows.length === 0) {
      throw new Error("Code d'invitation invalide");
    }
    const invite = rows[0];

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      throw new Error("Code d'invitation expiré");
    }
    if (invite.uses >= invite.max_uses) {
      throw new Error("Code d'invitation déjà utilisé");
    }

    await client.query(
      `UPDATE invites
       SET uses = uses + 1,
           used_at = CASE WHEN uses + 1 >= max_uses THEN NOW() ELSE used_at END
       WHERE code = $1`,
      [code]
    );

    await client.query('COMMIT');
    return { createdBy: invite.created_by, code };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Liste les invitations créées par un utilisateur.
 */
async function listForUser(userId) {
  const { rows } = await db.query(
    `SELECT i.code, i.max_uses, i.uses, i.expires_at, i.created_at, i.used_at,
            u.display_name AS used_by_name
     FROM invites i
     LEFT JOIN users u ON u.id = i.used_by
     WHERE i.created_by = $1
     ORDER BY i.created_at DESC
     LIMIT 50`,
    [userId]
  );
  return rows;
}

/**
 * Révoque un code (par son créateur).
 */
async function revoke(code, userId) {
  const { rowCount } = await db.query(
    `DELETE FROM invites WHERE code = $1 AND created_by = $2 AND uses = 0`,
    [code, userId]
  );
  return rowCount > 0;
}

module.exports = {
  generateCode,
  create,
  consume,
  listForUser,
  revoke,
};
