# Buchat

Application de communication locale par **Buja Online** — Bujumbura, Burundi.

Chat texte, messages vocaux, appels audio et vidéo. Aucun message stocké sur le serveur.

## Architecture

- **Serveur** : Node.js + Socket.IO (relais uniquement)
- **Mobile** : React Native (Expo)
- **Appels** : WebRTC (P2P)
- **Offline** : Redis (TTL 1h)

## Installation serveur

```bash
git clone https://github.com/niyomwungerefiston-arch/root0314.git /opt/buchat
cd /opt/buchat
chmod +x deploy/install.sh
./deploy/install.sh
```

## Configuration mobile

Dans `mobile/src/services/socket.js`, remplacez `YOUR_SERVER_IP` par l'IP de votre serveur.

## Couleurs

| Élément | Couleur |
|---|---|
| Bleu principal | `#1976D2` |
| Orange accent | `#F57C00` |
| Bleu foncé | `#0D1B2A` |

© 2026 Buja Online — Bujumbura, Burundi
