import { io } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Change this to your server IP
const SERVER_URL = 'http://YOUR_SERVER_IP:3000';

let socket = null;

export async function connectSocket() {
  const token = await AsyncStorage.getItem('token');
  if (!token) throw new Error('Non authentifié');

  socket = io(SERVER_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  return new Promise((resolve, reject) => {
    socket.on('connect', () => {
      console.log('Connecté au serveur Buchat');
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      console.error('Erreur de connexion:', err.message);
      reject(err);
    });
  });
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

// --- Auth API ---

export async function apiRegister(phone, password, displayName) {
  const res = await fetch(`${SERVER_URL}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password, displayName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  await AsyncStorage.setItem('token', data.token);
  await AsyncStorage.setItem('user', JSON.stringify(data.user));
  return data;
}

export async function apiLogin(phone, password) {
  const res = await fetch(`${SERVER_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  await AsyncStorage.setItem('token', data.token);
  await AsyncStorage.setItem('user', JSON.stringify(data.user));
  return data;
}

export async function apiGetUsers() {
  const token = await AsyncStorage.getItem('token');
  const res = await fetch(`${SERVER_URL}/api/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data;
}

export async function logout() {
  disconnectSocket();
  await AsyncStorage.removeItem('token');
  await AsyncStorage.removeItem('user');
}

export async function getCurrentUser() {
  const userStr = await AsyncStorage.getItem('user');
  return userStr ? JSON.parse(userStr) : null;
}
