require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');

const db = require('./db');
const auth = require('./auth');
const invites = require('./invites');
const redis = require('./redis');
const storage = require('./storage');
const push = require('./push');
const messages = require('./messages');
const groups = require('./groups');
const chats = require('./chats');
const { createRegistry } = require('./users');
const mediaRouter = require('./media');
const { setupChat } = require('./chat');
const { setupCalls } = require('./calls');

const PORT = process.env.PORT || 3000;
const INVITE_ONLY = process.env.BUCHAT_INVITE_ONLY === 'true';

// ========================
//  App & HTTP
// ========================

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Statics
app.use('/preview', express.static(path.join(__dirname, '..', '..', 'web-preview')));
app.use('/app', express.static(path.join(__dirname, '..', '..', 'web-preview')));
app.use('/website', express.static(path.join(__dirname, '..', '..', 'website')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 5e6,
});

// Multi-device registry
const users = createRegistry();

// ========================
//  Helpers
// ========================

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = token ? auth.verifyToken(token) : null;
  if (!user) return res.status(401).json({ error: 'Non autorisé' });
  req.user = user;
  next();
}

// ========================
//  REST — Public
// ========================

app.get('/health', async (req, res) => {
  res.json({
    name: 'Buchat Server',
    version: '1.2.0',
    inviteOnly: INVITE_ONLY,
    server: 'ok',
    database: (await db.ping().catch(() => false)) ? 'ok' : 'down',
    storage: storage.isAvailable() ? 'ok' : 'down',
    push: push.isEnabled() ? 'ok' : 'disabled',
    onlineUsers: users.listOnline().length,
  });
});

app.get('/api/config', (req, res) => {
  res.json({
    vapidPublicKey: push.getPublicKey() || null,
    inviteOnly: INVITE_ONLY,
    version: '1.2.0',
  });
});

// ========================
//  REST — Auth
// ========================

app.post('/api/register', async (req, res) => {
  try {
    const { phone, password, displayName, inviteCode } = req.body;
    const result = await auth.register(phone, password, displayName, inviteCode);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const result = await auth.login(phone, password);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// ========================
//  REST — Users
// ========================

app.get('/api/users', requireAuth, async (req, res) => {
  res.json(await auth.getAllUsers());
});

app.get('/api/users/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json([]);
  res.json(await auth.searchUsers(q));
});

app.get('/api/me', requireAuth, async (req, res) => {
  const user = await auth.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json(user);
});

app.patch('/api/me', requireAuth, async (req, res) => {
  try {
    const { displayName, about } = req.body;
    const user = await auth.updateProfile(req.user.id, { displayName, about });
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ========================
//  REST — Invites
// ========================

app.post('/api/invites', requireAuth, async (req, res) => {
  try {
    const { maxUses, expiryDays } = req.body;
    res.json(await invites.create(req.user.id, { maxUses, expiryDays }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/invites', requireAuth, async (req, res) => {
  res.json(await invites.listForUser(req.user.id));
});

app.delete('/api/invites/:code', requireAuth, async (req, res) => {
  res.json({ ok: await invites.revoke(req.params.code, req.user.id) });
});

// ========================
//  REST — Push
// ========================

app.post('/api/push/subscribe', requireAuth, async (req, res) => {
  try {
    const { subscription, platform } = req.body;
    await push.subscribe(req.user.id, subscription, {
      userAgent: req.headers['user-agent'],
      platform,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/push/unsubscribe', requireAuth, async (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) await push.unsubscribe(endpoint);
  res.json({ ok: true });
});

// ========================
//  REST — Messages (historique + recherche)
// ========================

app.get('/api/messages/direct/:peerId', requireAuth, async (req, res) => {
  try {
    const { limit, before } = req.query;
    const list = await messages.getDirectHistory(req.user.id, req.params.peerId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      before,
    });
    res.json(list);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/messages/group/:groupId', requireAuth, async (req, res) => {
  try {
    const { limit, before } = req.query;
    const list = await messages.getGroupHistory(req.user.id, req.params.groupId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      before,
    });
    res.json(list);
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

app.get('/api/messages/search', requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').toString();
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    res.json(await messages.search(req.user.id, q, { limit }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ========================
//  REST — Groups
// ========================

app.get('/api/groups', requireAuth, async (req, res) => {
  res.json(await groups.listForUser(req.user.id));
});

app.post('/api/groups', requireAuth, async (req, res) => {
  try {
    const { name, members, about } = req.body;
    res.json(await groups.create(req.user.id, { name, members, about }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/groups/:id', requireAuth, async (req, res) => {
  const g = await groups.get(req.params.id, req.user.id);
  if (!g) return res.status(404).json({ error: 'Groupe introuvable' });
  res.json(g);
});

app.patch('/api/groups/:id', requireAuth, async (req, res) => {
  try {
    const { name, about, avatarUrl } = req.body;
    res.json(await groups.update(req.params.id, req.user.id, { name, about, avatarUrl }));
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

app.post('/api/groups/:id/members', requireAuth, async (req, res) => {
  try {
    const { userId } = req.body;
    res.json(await groups.addMember(req.params.id, req.user.id, userId));
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

app.delete('/api/groups/:id/members/:userId', requireAuth, async (req, res) => {
  try {
    await groups.removeMember(req.params.id, req.user.id, req.params.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

// ========================
//  REST — Chat settings (block/archive/pin/mute)
// ========================

app.get('/api/chats/settings', requireAuth, async (req, res) => {
  res.json(await chats.list(req.user.id));
});

app.get('/api/chats/blocked', requireAuth, async (req, res) => {
  res.json(await chats.listBlocked(req.user.id));
});

// peer/:peerId or group/:groupId
function parseChatTarget(req) {
  if (req.params.peerId)  return { peerId: req.params.peerId };
  if (req.params.groupId) return { groupId: req.params.groupId };
  throw new Error('Cible invalide');
}

for (const kind of ['peer', 'group']) {
  const idKey = kind === 'peer' ? 'peerId' : 'groupId';
  app.post(`/api/chats/${kind}/:${idKey}/pin`,        requireAuth, wrap((req) => chats.pin(req.user.id, parseChatTarget(req))));
  app.post(`/api/chats/${kind}/:${idKey}/unpin`,      requireAuth, wrap((req) => chats.unpin(req.user.id, parseChatTarget(req))));
  app.post(`/api/chats/${kind}/:${idKey}/archive`,    requireAuth, wrap((req) => chats.archive(req.user.id, parseChatTarget(req))));
  app.post(`/api/chats/${kind}/:${idKey}/unarchive`,  requireAuth, wrap((req) => chats.unarchive(req.user.id, parseChatTarget(req))));
  app.post(`/api/chats/${kind}/:${idKey}/mute`,       requireAuth, wrap((req) => chats.mute(req.user.id, parseChatTarget(req), req.body?.hours || 8)));
  app.post(`/api/chats/${kind}/:${idKey}/unmute`,     requireAuth, wrap((req) => chats.unmute(req.user.id, parseChatTarget(req))));
}

app.post('/api/chats/block/:userId', requireAuth, wrap((req) => chats.block(req.user.id, req.params.userId, req.body?.reason)));
app.post('/api/chats/unblock/:userId', requireAuth, wrap((req) => chats.unblock(req.user.id, req.params.userId)));

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req); res.json({ ok: true }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  };
}

// ========================
//  REST — Media (MinIO)
// ========================

app.use('/api/media', mediaRouter);

// ========================
//  Socket.IO — Auth
// ========================

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Token requis'));
  const user = auth.verifyToken(token);
  if (!user) return next(new Error('Token invalide'));
  socket.user = user;
  next();
});

io.on('connection', async (socket) => {
  const user = socket.user;
  const wasOnline = users.isOnline(user.id);
  users.add(socket);
  await redis.setOnline(user.id);
  await auth.updateLastSeen(user.id).catch(() => {});

  console.log(`✓ ${user.displayName} connecté (${user.id}) — ${users.countDevices(user.id)} device(s)`);

  if (!wasOnline) {
    socket.broadcast.emit('user_online', {
      userId: user.id,
      displayName: user.displayName,
    });
  }

  // Livrer la queue Redis (messages reçus hors-ligne)
  const queued = await redis.getQueuedMessages(user.id);
  if (queued.length > 0) {
    socket.emit('offline_messages', queued);
    console.log(`  → ${queued.length} messages en attente livrés`);
  }

  socket.on('get_online_users', () => {
    socket.emit('online_users', users.listOnline().filter((id) => id !== user.id));
  });

  socket.on('disconnect', async () => {
    users.remove(socket);
    const stillOnline = users.isOnline(user.id);

    if (!stillOnline) {
      await redis.setOffline(user.id);
      await auth.updateLastSeen(user.id).catch(() => {});
      socket.broadcast.emit('user_offline', {
        userId: user.id,
        displayName: user.displayName,
      });
      console.log(`✗ ${user.displayName} déconnecté (tous devices)`);
    } else {
      console.log(`— ${user.displayName} : 1 device déconnecté, ${users.countDevices(user.id)} restant`);
    }
  });
});

setupChat(io, users, { push });
setupCalls(io, users, { push });

// ========================
//  Start
// ========================

async function start() {
  try {
    await db.ping();
    console.log('✓ PostgreSQL connecté');
    await db.migrate();
    console.log('✓ Migrations appliquées');
  } catch (err) {
    console.error('✗ PostgreSQL indisponible :', err.message);
    process.exit(1);
  }

  try { await redis.connect(); }
  catch { console.warn('⚠ Redis indisponible — messages offline désactivés'); }

  await storage.connect();
  push.configure();

  // Job de purge périodique (toutes les 6h)
  const PURGE_INTERVAL = parseInt(process.env.MESSAGE_PURGE_INTERVAL_MS || '21600000', 10);
  setInterval(async () => {
    try {
      const { rows } = await db.query('SELECT purge_old_messages($1) AS n', [messages.MESSAGE_TTL_DAYS]);
      if (rows[0].n > 0) {
        console.log(`🧹 Purge : ${rows[0].n} messages supprimés (>${messages.MESSAGE_TTL_DAYS}j)`);
      }
    } catch (err) {
      console.warn('⚠ purge_old_messages :', err.message);
    }
  }, PURGE_INTERVAL);

  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║         🟠 BUCHAT SERVER 🔵          ║');
    console.log(`║   Port: ${String(PORT).padEnd(29)}║`);
    console.log(`║   Mode: ${INVITE_ONLY ? 'invitation seulement         ' : 'ouvert                       '}║`);
    console.log(`║   TTL messages: ${String(messages.MESSAGE_TTL_DAYS + 'j').padEnd(21)}║`);
    console.log('║   Buja Online — Bujumbura, Burundi   ║');
    console.log('╚══════════════════════════════════════╝');
    console.log('');
  });
}

start().catch((err) => {
  console.error('✗ Démarrage échoué :', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  console.log('→ SIGTERM, arrêt propre...');
  server.close();
  await db.close();
  process.exit(0);
});
