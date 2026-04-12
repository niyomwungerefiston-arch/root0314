#!/bin/bash
# ============================================
#  Buchat — Script d'installation serveur
#  Buja Online — Bujumbura, Burundi
# ============================================

set -e

echo ""
echo "╔══════════════════════════════════════╗"
echo "║      🟠 BUCHAT INSTALLATION 🔵      ║"
echo "║      Buja Online — Burundi           ║"
echo "╚══════════════════════════════════════╝"
echo ""

# 1. System updates
echo "→ Mise à jour du système..."
apt update && apt upgrade -y

# 2. Install Node.js (if not installed)
if ! command -v node &> /dev/null; then
    echo "→ Installation de Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt install -y nodejs
fi
echo "  Node.js: $(node --version)"

# 3. Install Redis
echo "→ Installation de Redis..."
apt install -y redis-server
systemctl enable redis-server
systemctl start redis-server
echo "  Redis: OK"

# 4. Install coturn (TURN/STUN)
echo "→ Installation de coturn..."
apt install -y coturn
cp /opt/buchat/deploy/turnserver.conf /etc/turnserver.conf
# Enable coturn
sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
systemctl enable coturn
systemctl restart coturn
echo "  coturn: OK"

# 5. Install Nginx
echo "→ Installation de Nginx..."
apt install -y nginx certbot python3-certbot-nginx
cp /opt/buchat/deploy/nginx-buchat.conf /etc/nginx/sites-available/buchat
ln -sf /etc/nginx/sites-available/buchat /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
echo "  Nginx: OK"

# 6. Install PM2
echo "→ Installation de PM2..."
npm install -g pm2
echo "  PM2: OK"

# 7. Install server dependencies
echo "→ Installation des dépendances Buchat..."
cd /opt/buchat/server
npm install --production
echo "  Dépendances: OK"

# 8. Start server
echo "→ Démarrage de Buchat..."
cd /opt/buchat
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup
echo "  Serveur: OK"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║      ✓ BUCHAT INSTALLÉ !             ║"
echo "║                                      ║"
echo "║  Serveur: http://localhost:3000       ║"
echo "║  TURN:    port 3478                   ║"
echo "║                                      ║"
echo "║  Prochaine étape:                     ║"
echo "║  → Configurer le SSL avec certbot     ║"
echo "║  → Mettre l'IP du serveur dans l'app  ║"
echo "╚══════════════════════════════════════╝"
echo ""
