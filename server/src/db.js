/**
 * Buchat — PostgreSQL connection pool & migrations runner
 *
 * Connexion : DATABASE_URL (postgres://user:pass@host:5432/buchat)
 * Pool : 20 connexions par défaut, réglable via PG_POOL_MAX.
 *
 * Les migrations SQL sont dans server/sql/*.sql et s'exécutent
 * au démarrage de façon idempotente (IF NOT EXISTS).
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgres://buchat:buchat@localhost:5432/buchat';

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: parseInt(process.env.PG_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('⚠ PostgreSQL pool error:', err.message);
});

/**
 * Exécute une requête SQL avec paramètres.
 * Usage : const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
 */
async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Récupère un client du pool pour les transactions.
 * Usage :
 *   const client = await db.getClient();
 *   try {
 *     await client.query('BEGIN');
 *     ...
 *     await client.query('COMMIT');
 *   } catch (e) {
 *     await client.query('ROLLBACK');
 *     throw e;
 *   } finally {
 *     client.release();
 *   }
 */
async function getClient() {
  return pool.connect();
}

/**
 * Lance les migrations SQL (server/sql/*.sql) dans l'ordre.
 * Idempotent grâce aux CREATE IF NOT EXISTS.
 */
async function migrate() {
  const sqlDir = path.join(__dirname, '..', 'sql');
  if (!fs.existsSync(sqlDir)) {
    console.warn('⚠ Dossier SQL absent :', sqlDir);
    return;
  }
  const files = fs
    .readdirSync(sqlDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(sqlDir, file), 'utf8');
    console.log(`  → migration ${file}`);
    await pool.query(sql);
  }
}

/**
 * Test de connectivité (healthcheck).
 */
async function ping() {
  const { rows } = await pool.query('SELECT 1 AS ok');
  return rows[0].ok === 1;
}

async function close() {
  await pool.end();
}

module.exports = {
  pool,
  query,
  getClient,
  migrate,
  ping,
  close,
};
