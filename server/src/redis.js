const { createClient } = require('redis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const MESSAGE_TTL = 3600; // 1 hour in seconds

let client = null;

async function connect() {
  try {
    client = createClient({
      url: REDIS_URL,
      socket: {
        connectTimeout: 2000,
        reconnectStrategy: false, // Don't retry if Redis is unavailable
      },
    });
    client.on('error', () => {}); // Suppress repeated errors
    await client.connect();
    console.log('✓ Redis connecté');
    return client;
  } catch {
    console.warn('⚠ Redis non disponible — mode sans cache offline');
    client = null;
    return null;
  }
}

// Queue offline messages (auto-deleted after 1h)
async function queueMessage(userId, message) {
  if (!client) return;
  const key = `offline:${userId}`;
  await client.rPush(key, JSON.stringify(message));
  await client.expire(key, MESSAGE_TTL);
}

// Retrieve and clear queued messages when user comes online
async function getQueuedMessages(userId) {
  if (!client) return [];
  const key = `offline:${userId}`;
  const messages = await client.lRange(key, 0, -1);
  await client.del(key);
  return messages.map((m) => JSON.parse(m));
}

// Track online status
async function setOnline(userId) {
  if (!client) return;
  await client.set(`online:${userId}`, 'true', { EX: 300 }); // 5 min TTL
}

async function setOffline(userId) {
  if (!client) return;
  await client.del(`online:${userId}`);
}

async function isOnline(userId) {
  if (!client) return false;
  const status = await client.get(`online:${userId}`);
  return status === 'true';
}

function getClient() {
  return client;
}

module.exports = {
  connect,
  queueMessage,
  getQueuedMessages,
  setOnline,
  setOffline,
  isOnline,
  getClient,
};
