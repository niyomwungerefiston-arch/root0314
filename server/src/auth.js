const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const JWT_SECRET = process.env.JWT_SECRET || 'buchat-secret-change-in-production';
const TOKEN_EXPIRY = '30d';

// In-memory user store (no persistent DB — privacy first)
// In production, use Redis with TTL or a lightweight DB for user accounts only
const users = new Map();

function generateToken(user) {
  return jwt.sign(
    { id: user.id, phone: user.phone, displayName: user.displayName },
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

async function register(phone, password, displayName) {
  if (users.has(phone)) {
    throw new Error('Ce numéro est déjà enregistré');
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = {
    id: uuidv4(),
    phone,
    password: hashedPassword,
    displayName: displayName || phone,
    createdAt: Date.now(),
  };

  users.set(phone, user);

  const token = generateToken(user);
  return {
    token,
    user: { id: user.id, phone: user.phone, displayName: user.displayName },
  };
}

async function login(phone, password) {
  const user = users.get(phone);
  if (!user) {
    throw new Error('Numéro non trouvé');
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    throw new Error('Mot de passe incorrect');
  }

  const token = generateToken(user);
  return {
    token,
    user: { id: user.id, phone: user.phone, displayName: user.displayName },
  };
}

function getUser(phone) {
  const user = users.get(phone);
  if (!user) return null;
  return { id: user.id, phone: user.phone, displayName: user.displayName };
}

function getUserById(id) {
  for (const user of users.values()) {
    if (user.id === id) {
      return { id: user.id, phone: user.phone, displayName: user.displayName };
    }
  }
  return null;
}

function getAllUsers() {
  return Array.from(users.values()).map((u) => ({
    id: u.id,
    phone: u.phone,
    displayName: u.displayName,
  }));
}

module.exports = {
  generateToken,
  verifyToken,
  register,
  login,
  getUser,
  getUserById,
  getAllUsers,
};
