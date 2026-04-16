/**
 * Buchat — Routes HTTP pour upload / download de médias.
 *
 *   POST /api/media/avatar    — upload avatar (image, max 2 MB)
 *   POST /api/media/upload    — upload photo/vidéo/doc (max 25 MB)
 *   POST /api/media/voice     — upload message vocal (max 5 MB)
 *   GET  /api/media/url/:bucket/:objectName  — URL présignée (téléchargement)
 *
 * Tous les endpoints requièrent un token JWT valide.
 */

const express = require('express');
const multer = require('multer');
const storage = require('./storage');
const auth = require('./auth');

const router = express.Router();

// ------- Upload en mémoire (pas sur disque) -------
const mem = multer({ storage: multer.memoryStorage() });

const limits = {
  avatar: 2 * 1024 * 1024, // 2 MB
  media: 25 * 1024 * 1024, // 25 MB
  voice: 5 * 1024 * 1024, // 5 MB
};

const allowedMime = {
  avatar: /^image\/(jpeg|png|webp|gif)$/,
  media: /^(image|video|audio|application\/pdf)/,
  voice: /^audio\//,
};

// ------- Middleware : authentification JWT -------
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = token ? auth.verifyToken(token) : null;
  if (!user) return res.status(401).json({ error: 'Non autorisé' });
  req.user = user;
  next();
}

// ------- POST /api/media/avatar -------
router.post('/avatar', requireAuth, mem.single('file'), async (req, res) => {
  try {
    if (!storage.isAvailable()) {
      return res.status(503).json({ error: 'Stockage non disponible' });
    }
    if (!req.file) return res.status(400).json({ error: 'Fichier manquant' });
    if (req.file.size > limits.avatar) {
      return res.status(413).json({ error: 'Image trop grosse (max 2 MB)' });
    }
    if (!allowedMime.avatar.test(req.file.mimetype)) {
      return res.status(415).json({ error: 'Format non supporté' });
    }

    const objectName = storage.makeObjectName(req.user.id, req.file.originalname);
    await storage.upload(
      storage.BUCKETS.AVATARS,
      objectName,
      req.file.buffer,
      req.file.mimetype
    );

    const url = storage.publicUrl(storage.BUCKETS.AVATARS, objectName);
    // Met à jour le profil utilisateur
    await auth.updateProfile(req.user.id, { avatarUrl: url });
    res.json({ url, bucket: storage.BUCKETS.AVATARS, objectName });
  } catch (err) {
    console.error('avatar upload:', err.message);
    res.status(500).json({ error: 'Échec upload' });
  }
});

// ------- POST /api/media/upload (photo/vidéo/doc) -------
router.post('/upload', requireAuth, mem.single('file'), async (req, res) => {
  try {
    if (!storage.isAvailable()) {
      return res.status(503).json({ error: 'Stockage non disponible' });
    }
    if (!req.file) return res.status(400).json({ error: 'Fichier manquant' });
    if (req.file.size > limits.media) {
      return res.status(413).json({ error: 'Fichier trop gros (max 25 MB)' });
    }
    if (!allowedMime.media.test(req.file.mimetype)) {
      return res.status(415).json({ error: 'Format non supporté' });
    }

    const objectName = storage.makeObjectName(req.user.id, req.file.originalname);
    await storage.upload(
      storage.BUCKETS.MEDIA,
      objectName,
      req.file.buffer,
      req.file.mimetype
    );

    // URL présignée 24h
    const url = await storage.presignedGetUrl(
      storage.BUCKETS.MEDIA,
      objectName,
      24 * 3600
    );
    res.json({
      url,
      bucket: storage.BUCKETS.MEDIA,
      objectName,
      size: req.file.size,
      mimetype: req.file.mimetype,
      originalName: req.file.originalname,
    });
  } catch (err) {
    console.error('media upload:', err.message);
    res.status(500).json({ error: 'Échec upload' });
  }
});

// ------- POST /api/media/voice (messages vocaux) -------
router.post('/voice', requireAuth, mem.single('file'), async (req, res) => {
  try {
    if (!storage.isAvailable()) {
      return res.status(503).json({ error: 'Stockage non disponible' });
    }
    if (!req.file) return res.status(400).json({ error: 'Fichier manquant' });
    if (req.file.size > limits.voice) {
      return res.status(413).json({ error: 'Message vocal trop long (max 5 MB)' });
    }
    if (!allowedMime.voice.test(req.file.mimetype)) {
      return res.status(415).json({ error: 'Format audio non supporté' });
    }

    const objectName = storage.makeObjectName(req.user.id, req.file.originalname || 'voice.webm');
    await storage.upload(
      storage.BUCKETS.VOICE,
      objectName,
      req.file.buffer,
      req.file.mimetype
    );

    // URL présignée 1h (écoute immédiate)
    const url = await storage.presignedGetUrl(
      storage.BUCKETS.VOICE,
      objectName,
      3600
    );
    res.json({
      url,
      bucket: storage.BUCKETS.VOICE,
      objectName,
      duration: req.body.duration || null,
    });
  } catch (err) {
    console.error('voice upload:', err.message);
    res.status(500).json({ error: 'Échec upload' });
  }
});

// ------- GET /api/media/url/:bucket/:objectName -------
// Re-génère une URL présignée pour relire un média partagé.
router.get('/url/*', requireAuth, async (req, res) => {
  try {
    const fullPath = req.params[0];
    const [bucket, ...rest] = fullPath.split('/');
    const objectName = rest.join('/');

    if (!Object.values(storage.BUCKETS).includes(bucket)) {
      return res.status(400).json({ error: 'Bucket invalide' });
    }
    if (!objectName) return res.status(400).json({ error: 'Objet manquant' });

    const url = await storage.presignedGetUrl(bucket, objectName, 3600);
    res.json({ url });
  } catch (err) {
    console.error('presigned url:', err.message);
    res.status(500).json({ error: 'Échec' });
  }
});

module.exports = router;
