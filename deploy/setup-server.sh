#!/bin/bash
# Run on the Oracle Ubuntu server:  sudo bash deploy/setup-server.sh yourdomain.com
set -e
DOMAIN="$1"
if [ -z "$DOMAIN" ]; then echo "Usage: sudo bash deploy/setup-server.sh yourdomain.com"; exit 1; fi
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "== Installing Node.js 22 and Caddy =="
apt-get update -y
apt-get install -y curl debian-keyring debian-archive-keyring apt-transport-https gpg
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y
apt-get install -y caddy

echo "== Installing app =="
cd "$APP_DIR"
npm install --omit=dev
mkdir -p /var/edge/data /var/edge/images
[ -d "$APP_DIR/data" ] && cp -rn "$APP_DIR/data/." /var/edge/data/ || true

if [ ! -f /etc/edge.env ]; then
  cat > /etc/edge.env <<ENV
PORT=3000
HOST=127.0.0.1
JOURNAL_DATA_DIR=/var/edge/data
JOURNAL_IMAGE_DIR=/var/edge/images
GROQ_API_KEY=PUT_YOUR_NEW_KEY_HERE
GROQ_MODEL=openai/gpt-oss-20b
ENV
  chmod 600 /etc/edge.env
fi

sed "s#__APP_DIR__#$APP_DIR#g" deploy/edge.service > /etc/systemd/system/edge.service
sed "s#__DOMAIN__#$DOMAIN#g" deploy/Caddyfile > /etc/caddy/Caddyfile

echo "== Opening web ports in the server firewall =="
iptables -I INPUT -p tcp --dport 80 -j ACCEPT || true
iptables -I INPUT -p tcp --dport 443 -j ACCEPT || true
(command -v netfilter-persistent >/dev/null && netfilter-persistent save) || true

systemctl daemon-reload
systemctl enable --now edge
systemctl restart caddy
echo
echo "Done. Now edit the key:  sudo nano /etc/edge.env   then:  sudo systemctl restart edge"
echo "Open: https://$DOMAIN"
