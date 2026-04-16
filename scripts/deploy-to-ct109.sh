#!/usr/bin/env bash
# ==========================================================
# Buchat — Déploiement vers CT 109 (Proxmox)
# ==========================================================
#
# Synchronise tout le projet vers /opt/buchat sur le CT 109,
# redémarre le serveur Node.js et recharge Nginx.
#
# Prérequis :
#   - Accès SSH au CT 109 (clé publique)
#   - Variable CT109_HOST (ex: root@10.10.0.109)
#   - L'installation initiale a été faite via deploy/install.sh
#
# Usage :
#   CT109_HOST=root@10.10.0.109 ./scripts/deploy-to-ct109.sh
#   CT109_HOST=root@10.10.0.109 ./scripts/deploy-to-ct109.sh --full
# ==========================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${CT109_HOST:-}"
MODE="${1:-incremental}"

if [ -z "$HOST" ]; then
  echo "✗ Définissez CT109_HOST (ex: root@10.10.0.109)"
  exit 1
fi

echo "→ Déploiement vers $HOST..."

# 1. Synchroniser le code (sans node_modules, sans secrets)
echo "→ rsync du code..."
rsync -avz --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='*.keystore' \
  --exclude='desktop/dist' \
  --exclude='android/android' \
  --exclude='website/downloads/*.exe' \
  --exclude='website/downloads/*.dmg' \
  --exclude='website/downloads/*.apk' \
  --exclude='website/downloads/*.AppImage' \
  --exclude='website/downloads/*.deb' \
  "$ROOT/" "$HOST:/opt/buchat/"

# 2. Synchroniser les binaires séparément (si présents localement)
if ls "$ROOT/website/downloads/"*.{exe,dmg,apk,AppImage,deb} &>/dev/null 2>&1; then
  echo "→ Upload des binaires..."
  rsync -avz --progress \
    "$ROOT/website/downloads/" \
    "$HOST:/opt/buchat/website/downloads/"
fi

# 3. Installer les deps serveur + redémarrer
ssh "$HOST" bash <<'ENDSSH'
set -e
cd /opt/buchat/server
npm install --omit=dev --no-audit --no-fund

# Nginx : déployer la config si elle a changé
if ! diff -q /opt/buchat/deploy/nginx-buchat.conf /etc/nginx/sites-available/buchat &>/dev/null; then
  cp /opt/buchat/deploy/nginx-buchat.conf /etc/nginx/sites-available/buchat
  nginx -t && systemctl reload nginx
  echo "✓ Nginx rechargé"
fi

# Redémarrage du backend
if pm2 describe buchat &>/dev/null; then
  pm2 reload buchat
  echo "✓ Backend rechargé"
else
  cd /opt/buchat
  pm2 start deploy/ecosystem.config.js
  pm2 save
  echo "✓ Backend démarré"
fi
ENDSSH

echo ""
echo "✓ Déploiement terminé."
echo "  → https://buchat.bujaonline.com"
echo "  → https://buchat.bujaonline.com/app/    (PWA)"
echo "  → https://buchat.bujaonline.com/downloads/  (binaires)"
