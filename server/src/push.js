/**
 * Buchat — Notifications push Web Push (VAPID)
 *
 * 100% auto-hébergé. Pas de Firebase, pas d'APNS.
 * Fonctionne sur :
 *   - Chrome / Edge / Firefox (Android + Desktop)
 *   - Safari iOS 16.4+ (en PWA installée)
 *   - Safari macOS 13+
 *
 * Génération des clés VAPID (une seule fois, à mettre dans .env) :
 *   npm run generate-vapid
 */

const webpush = require('web-push');
const db = require('./db');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:contact@bujaonline.com';

let configured = false;

function configure() {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.warn('⚠ VAPID keys manquantes — Web Push désactivé');
    console.warn('  Générez des clés : npm run generate-vapid');
    return false;
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  configured = true;
  console.log('✓ Web Push configuré (VAPID)');
  return true;
}

function getPublicKey() {
  return VAPID_PUBLIC;
}

function isEnabled() {
  return configured;
}

/**
 * Enregistre ou met à jour une souscription push pour un utilisateur.
 * Un utilisateur peut avoir plusieurs abonnements (plusieurs appareils).
 */
async function subscribe(userId, subscription, { userAgent, platform } = {}) {
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    throw new Error('Souscription invalide');
  }
  const { endpoint, keys } = subscription;

  await db.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, platform)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent,
           platform = EXCLUDED.platform,
           last_used_at = NOW()`,
    [userId, endpoint, keys.p256dh, keys.auth, userAgent || null, platform || null]
  );

  return { ok: true };
}

/**
 * Supprime un abonnement (logout ou désinstallation).
 */
async function unsubscribe(endpoint) {
  await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

/**
 * Envoie une notification à TOUS les appareils d'un utilisateur.
 * Si un appareil retourne 404/410, on le supprime (abonnement expiré).
 */
async function sendToUser(userId, payload) {
  if (!configured) return { sent: 0, failed: 0 };

  const { rows } = await db.query(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
    [userId]
  );
  if (rows.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  const jsonPayload = JSON.stringify(payload);

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          jsonPayload,
          { TTL: 60 * 60 * 24 } // retry pendant 24h
        );
        sent++;
        db.query('UPDATE push_subscriptions SET last_used_at = NOW() WHERE id = $1', [row.id]).catch(() => {});
      } catch (err) {
        failed++;
        // 404/410 = abonnement expiré ou révoqué
        if (err.statusCode === 404 || err.statusCode === 410) {
          db.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id]).catch(() => {});
        }
      }
    })
  );

  return { sent, failed };
}

/**
 * Format standard pour les notifications Buchat.
 */
function buildMessageNotification({ fromName, preview, chatId }) {
  return {
    title: fromName || 'Buchat',
    body: preview || 'Nouveau message',
    icon: '/app/icons/icon-192.png',
    badge: '/app/icons/icon-96.png',
    tag: `chat-${chatId || 'general'}`, // remplace les notifs du même chat
    vibrate: [200, 100, 200],
    data: {
      url: `/app/?chat=${chatId || ''}`,
      chatId,
    },
    actions: [
      { action: 'reply', title: 'Répondre' },
      { action: 'open', title: 'Ouvrir' },
    ],
  };
}

function buildCallNotification({ fromName, chatId, isVideo }) {
  return {
    title: `Appel ${isVideo ? 'vidéo' : 'audio'} de ${fromName || 'quelqu\'un'}`,
    body: 'Appuyez pour répondre',
    icon: '/app/icons/icon-192.png',
    badge: '/app/icons/icon-96.png',
    tag: `call-${chatId}`,
    requireInteraction: true,
    vibrate: [500, 200, 500, 200, 500],
    data: {
      url: `/app/?call=${chatId}`,
      chatId,
      isVideo,
    },
    actions: [
      { action: 'answer', title: 'Répondre' },
      { action: 'decline', title: 'Refuser' },
    ],
  };
}

module.exports = {
  configure,
  getPublicKey,
  isEnabled,
  subscribe,
  unsubscribe,
  sendToUser,
  buildMessageNotification,
  buildCallNotification,
};
