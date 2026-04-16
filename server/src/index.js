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

// Serve static assets (legacy preview + PWA)
app.use('/preview', express.static(path.join(__dirname, '..', '..', 'web-preview')));
app.use('/app', express.static(path.join(__dirname, '..', '..', 'web-preview')));
app.use('/website', express.static(path.join(__dirname, '..', '..', 'website')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 5e6, // 5MB (audio messages legacy path)
});

// Connected users: userId -> socket
const connectedUsers = new Map();

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
//  REST API — Public
// ========================

app.get('/health', async (req, res) => {
  const checks = {
    server: 'ok',
    database: (await db.ping().catch(() => false)) ? 'ok' : 'down',
    storage: storage.isAvailable() ? 'ok' : 'down',
    push: push.isEnabled() ? 'ok' : 'disabled',
  };
  res.json({
    name: 'Buchat Server',
    version: '1.1.0',
    inviteOnly: INVITE_ONLY,
    ...checks,
  });
});

// Config publique exposée au client (clé VAPID publique, etc.)
app.get('/api/config', (req, res) => {
  res.json({
    vapidPublicKey: push.getPublicKey() || null,
    inviteOnly: INVITE_ONLY,
    version: '1.1.0',
  });
});

// ========================
//  REST API — Auth
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
//  REST API — Users
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
//  REST API — Invites
// ========================

app.post('/api/invites', requireAuth, async (req, res) => {
  try {
    const { maxUses, expiryDays } = req.body;
    const invite = await invites.create(req.user.id, { maxUses, expiryDays });
    res.json(invite);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/invites', requireAuth, async (req, res) => {
  res.json(await invites.listForUser(req.user.id));
});

app.delete('/api/invites/:code', requireAuth, async (req, res) => {
  const ok = await invites.revoke(req.params.code, req.user.id);
  res.json({ ok });
});

// ========================
//  REST API — Push
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
//  REST API — Media (MinIO)
// ========================

app.use('/api/media', mediaRouter);

// ========================
//  Socket.IO — Auth Middleware
// ========================

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Token requis'));
  const user = auth.verifyToken(token);
  if (!user) return next(new Error('Token invalide'));
  socket.user = user;
  next();
});

// ========================
//  Socket.IO — Connection
// ========================

io.on('connection', async (socket) => {
  const user = socket.user;
  console.log(`✓ ${user.displayName} connecté (${user.id})`);

  connectedUsers.set(user.id, socket);
  await redis.setOnline(user.id);
  await auth.updateLastSeen(user.id).catch(() => {});

  socket.broadcast.emit('user_online', {
    userId: user.id,
    displayName: user.displayName,
  });

  const queuedMessages = await redis.getQueuedMessages(user.id);
  if (queuedMessages.length > 0) {
    socket.emit('offline_messages', queuedMessages);
    console.log(`  → ${queuedMessages.length} messages en attente délivrés à ${user.displayName}`);
  }

  socket.on('get_online_users', () => {
    const onlineUsers = [];
    connectedUsers.forEach((s, userId) => {
      if (userId !== user.id) {
        onlineUsers.push({
          userId,
          displayName: s.user.displayName,
        });
      }
    });
    socket.emit('online_users', onlineUsers);
  });

  socket.on('disconnect', async () => {
    console.log(`✗ ${user.displayName} déconnecté`);
    connectedUsers.delete(user.id);
    await redis.setOffline(user.id);
    await auth.updateLastSeen(user.id).catch(() => {});

    socket.broadcast.emit('user_offline', {
      userId: user.id,
      displayName: user.displayName,
    });
  });
});

// ========================
//  Setup Chat & Calls (avec push)
// ========================

setupChat(io, connectedUsers, { push });
setupCalls(io, connectedUsers, { push });

// ========================
//  Start Server
// ========================

async function start() {
  // 1. PostgreSQL
  try {
    await db.ping();
    console.log('✓ PostgreSQL connecté');
    await db.migrate();
    console.log('✓ Migrations appliquées');
  } catch (err) {
    console.error('✗ PostgreSQL indisponible :', err.message);
    console.error('  Vérifiez DATABASE_URL ou lancez docker compose up -d postgres');
    process.exit(1);
  }

  // 2. Redis (optionnel — mode dégradé si absent)
  try {
    await redis.connect();
  } catch {
    console.warn('⚠ Redis non disponible — messages offline désactivés');
  }

  // 3. MinIO (optionnel)
  await storage.connect();

  // 4. Web Push VAPID (optionnel)
  push.configure();

  // 5. HTTP server
  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║         🟠 BUCHAT SERVER 🔵         ║');
    console.log(`║   Port: ${String(PORT).padEnd(29)}║`);
    console.log(`║   Mode: ${INVITE_ONLY ? 'invitation seulement       ' : 'ouvert                     '}  ║`);
    console.log('║   Buja Online — Bujumbura, Burundi   ║');
    console.log('╚══════════════════════════════════════╝');
    console.log('');
  });
}

start().catch((err) => {
  console.error('✗ Démarrage échoué :', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('→ SIGTERM reçu, arrêt propre...');
  server.close();
  await db.close();
  process.exit(0);
});
