require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const auth = require('./auth');
const redis = require('./redis');
const { setupChat } = require('./chat');
const { setupCalls } = require('./calls');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 5e6, // 5MB for audio messages
});

// Connected users: userId -> socket
const connectedUsers = new Map();

// ========================
//  REST API — Auth
// ========================

app.get('/health', (req, res) => {
  res.json({ status: 'ok', name: 'Buchat Server', version: '1.0.0' });
});

app.post('/api/register', async (req, res) => {
  try {
    const { phone, password, displayName } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ error: 'Numéro et mot de passe requis' });
    }
    const result = await auth.register(phone, password, displayName);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ error: 'Numéro et mot de passe requis' });
    }
    const result = await auth.login(phone, password);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/users', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !auth.verifyToken(token)) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  res.json(auth.getAllUsers());
});

// ========================
//  Socket.IO — Auth Middleware
// ========================

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Token requis'));
  }

  const user = auth.verifyToken(token);
  if (!user) {
    return next(new Error('Token invalide'));
  }

  socket.user = user;
  next();
});

// ========================
//  Socket.IO — Connection
// ========================

io.on('connection', async (socket) => {
  const user = socket.user;
  console.log(`✓ ${user.displayName} connecté (${user.id})`);

  // Track connected user
  connectedUsers.set(user.id, socket);
  await redis.setOnline(user.id);

  // Notify others that user is online
  socket.broadcast.emit('user_online', {
    userId: user.id,
    displayName: user.displayName,
  });

  // Deliver queued offline messages
  const queuedMessages = await redis.getQueuedMessages(user.id);
  if (queuedMessages.length > 0) {
    socket.emit('offline_messages', queuedMessages);
    console.log(`  → ${queuedMessages.length} messages en attente délivrés à ${user.displayName}`);
  }

  // Get online users list
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

  // Handle disconnect
  socket.on('disconnect', async () => {
    console.log(`✗ ${user.displayName} déconnecté`);
    connectedUsers.delete(user.id);
    await redis.setOffline(user.id);

    socket.broadcast.emit('user_offline', {
      userId: user.id,
      displayName: user.displayName,
    });
  });
});

// ========================
//  Setup Chat & Calls
// ========================

setupChat(io, connectedUsers);
setupCalls(io, connectedUsers);

// ========================
//  Start Server
// ========================

async function start() {
  try {
    await redis.connect();
  } catch (err) {
    console.warn('⚠ Redis non disponible — messages offline désactivés');
    console.warn('  Installez Redis: apt install redis-server');
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║         🟠 BUCHAT SERVER 🔵         ║');
    console.log('║                                      ║');
    console.log(`║   Port: ${PORT}                          ║`);
    console.log('║   Status: En ligne                   ║');
    console.log('║   Stockage: Aucun (relais uniquement)║');
    console.log('║                                      ║');
    console.log('║   Buja Online — Bujumbura, Burundi   ║');
    console.log('╚══════════════════════════════════════╝');
    console.log('');
  });
}

start();
