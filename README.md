# Buchat

Application de communication locale par **Buja Online** — Bujumbura, Burundi.

Chat texte, messages vocaux, appels audio et vidéo. Aucun message stocké sur le serveur.

**Site :** [buchat.bujaonline.com](https://buchat.bujaonline.com)

## Structure du dépôt

```
buchat/
├── server/        # Backend Node.js (Socket.IO + REST)
├── web-preview/   # PWA installable (iPhone, Android, Web)
├── website/       # Landing page buchat.bujaonline.com
├── desktop/       # Wrapper Electron (Windows, macOS, Linux)
├── android/       # Wrapper Capacitor (APK natif)
├── mobile/        # App React Native Expo (legacy, optionnel)
├── deploy/        # Scripts install + configs Nginx / PM2 / coturn
└── scripts/       # Build + déploiement
```

## Distribution multi-plateformes

L'application est distribuée **directement depuis notre propre site**,
sans passer par l'App Store ni le Play Store :

| Plateforme | Format | Installation |
|---|---|---|
| 📱 iPhone / iPad | PWA | Safari → Partager → "Ajouter à l'écran d'accueil" |
| 🤖 Android | APK direct | Téléchargement depuis le site |
| 🖥️ Windows 10/11 | `.exe` NSIS | Double-clic installer |
| 🍎 macOS | `.dmg` | Glisser dans Applications |
| 🐧 Linux | AppImage / .deb | Portable ou paquet Debian |
| 🌐 Navigateur | PWA web | Aucune installation |

## Installation serveur (CT 109)

```bash
git clone https://github.com/niyomwungerefiston-arch/root0314.git /opt/buchat
cd /opt/buchat
chmod +x deploy/install.sh
sudo ./deploy/install.sh
sudo certbot --nginx -d buchat.bujaonline.com
```

## Builder tous les binaires

```bash
./scripts/build-all.sh           # tout
./scripts/build-all.sh --desktop # Electron (Win/Mac/Linux)
./scripts/build-all.sh --android # APK
./scripts/build-all.sh --icons   # icônes PNG
```

## Déployer vers le CT 109

```bash
CT109_HOST=root@10.10.0.109 ./scripts/deploy-to-ct109.sh
```

## Développement local

```bash
# Backend
cd server && npm install && node src/index.js

# PWA (accessible sur http://localhost:3000/preview/)
# → servie automatiquement par le backend en dev

# Desktop (Electron, charge localhost:3000)
cd desktop && npm install && npm run dev
```

## Technologies

- **Backend** : Node.js 22, Socket.IO 4, Express, Redis, JWT, bcrypt
- **PWA** : Vanilla JS, Service Worker, Web Manifest
- **Desktop** : Electron 32 + electron-builder
- **Android** : Capacitor 6 (WebView natif)
- **WebRTC** : STUN public + coturn (TURN auto-hébergé)

## Couleurs

| Élément | Couleur |
|---|---|
| Bleu principal | `#1976D2` |
| Orange accent | `#F57C00` |
| Bleu foncé (header) | `#0D1B2A` |

© 2026 Buja Online — Bujumbura, Burundi
