#!/usr/bin/env node
/**
 * Buchat — Migration runner standalone.
 * Usage : npm run migrate
 */
require('dotenv').config();
const db = require('./db');

(async () => {
  try {
    console.log('→ Connexion PostgreSQL...');
    await db.ping();
    console.log('→ Exécution des migrations...');
    await db.migrate();
    console.log('✓ Migrations appliquées avec succès.');
  } catch (err) {
    console.error('✗ Erreur migration :', err.message);
    process.exit(1);
  } finally {
    await db.close();
  }
})();
