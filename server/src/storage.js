/**
 * Buchat — Stockage objet MinIO (S3-compatible)
 *
 * 3 buckets :
 *   - avatars   : photos de profil (accès public, lecture seule)
 *   - media     : photos/vidéos/docs partagés dans les chats (URL présignée)
 *   - voice     : messages vocaux (URL présignée, TTL court)
 *
 * Les URL présignées expirent après X minutes et n'exposent
 * pas les credentials MinIO. Seuls les destinataires autorisés
 * par le backend reçoivent une URL valide.
 */

const { Client: MinioClient } = require('minio');
const crypto = require('crypto');
const path = require('path');

const ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost';
const PORT = parseInt(process.env.MINIO_PORT || '9000', 10);
const USE_SSL = process.env.MINIO_USE_SSL === 'true';
const ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'buchat';
const SECRET_KEY = process.env.MINIO_SECRET_KEY || 'buchat-secret-change-me';
const PUBLIC_BASE =
  process.env.MINIO_PUBLIC_URL ||
  `${USE_SSL ? 'https' : 'http'}://${ENDPOINT}:${PORT}`;

const BUCKETS = {
  AVATARS: 'buchat-avatars',
  MEDIA: 'buchat-media',
  VOICE: 'buchat-voice',
};

let client = null;

async function connect() {
  try {
    client = new MinioClient({
      endPoint: ENDPOINT,
      port: PORT,
      useSSL: USE_SSL,
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
    });

    // S'assurer que les buckets existent
    for (const bucket of Object.values(BUCKETS)) {
      const exists = await client.bucketExists(bucket).catch(() => false);
      if (!exists) {
        await client.makeBucket(bucket);
        console.log(`  → bucket créé : ${bucket}`);
      }
    }

    // Les avatars sont publics en lecture (pour affichage direct)
    const publicPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: '*',
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${BUCKETS.AVATARS}/*`],
        },
      ],
    };
    try {
      await client.setBucketPolicy(BUCKETS.AVATARS, JSON.stringify(publicPolicy));
    } catch {
      // Policy peut échouer selon les perms — non bloquant
    }

    console.log('✓ MinIO connecté');
    return client;
  } catch (err) {
    console.warn('⚠ MinIO non disponible :', err.message);
    console.warn('  Upload de médias désactivé');
    client = null;
    return null;
  }
}

function getClient() {
  return client;
}

function isAvailable() {
  return client !== null;
}

/**
 * Génère un nom d'objet unique et safe.
 */
function makeObjectName(userId, originalName) {
  const ext = path.extname(originalName || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
  const rand = crypto.randomBytes(12).toString('hex');
  const ts = Date.now();
  return `${userId}/${ts}-${rand}${ext}`;
}

/**
 * Upload un buffer vers MinIO.
 */
async function upload(bucket, objectName, buffer, mimetype) {
  if (!client) throw new Error('MinIO non disponible');
  await client.putObject(bucket, objectName, buffer, buffer.length, {
    'Content-Type': mimetype,
    'Cache-Control': 'public, max-age=2592000',
  });
  return {
    bucket,
    objectName,
    size: buffer.length,
    mimetype,
  };
}

/**
 * URL publique (avatars uniquement).
 */
function publicUrl(bucket, objectName) {
  return `${PUBLIC_BASE}/${bucket}/${objectName}`;
}

/**
 * URL présignée temporaire (médias privés).
 * @param {number} expirySec  — durée de validité (défaut 1h)
 */
async function presignedGetUrl(bucket, objectName, expirySec = 3600) {
  if (!client) throw new Error('MinIO non disponible');
  return client.presignedGetObject(bucket, objectName, expirySec);
}

/**
 * Supprime un objet.
 */
async function remove(bucket, objectName) {
  if (!client) return;
  await client.removeObject(bucket, objectName);
}

module.exports = {
  BUCKETS,
  connect,
  getClient,
  isAvailable,
  makeObjectName,
  upload,
  publicUrl,
  presignedGetUrl,
  remove,
};
