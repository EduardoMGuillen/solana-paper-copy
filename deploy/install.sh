#!/usr/bin/env bash
# Install or update the paper bot on a fresh Debian 12 / Ubuntu 22+ VM
# (Google Cloud e2-micro or Oracle Cloud Always Free).
#
#   sudo bash install.sh                       # HTTPS on <ip>.sslip.io
#   sudo DOMAIN=bot.example.com bash install.sh  # your own domain
#
# Re-running it is safe: it pulls the latest code, rebuilds, keeps the
# password and the paper account, and restarts the service.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/EduardoMGuillen/solana-paper-copy.git}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/solana-bot
DATA_DIR=/var/lib/solana-bot
ENV_FILE=/etc/solana-bot.env
APP_USER=solbot
PORT=47231

if [[ $EUID -ne 0 ]]; then
  echo "Ejecuta con sudo: sudo bash install.sh" >&2
  exit 1
fi

step() { printf '\n==> %s\n' "$*"; }

step "Paquetes base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https openssl >/dev/null

step "Swap (la VM tiene ~1 GB de RAM; compilar Next.js necesita más)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "Swap de 2 GB creada."
else
  echo "Ya hay swap."
fi

step "Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v

step "Usuario del servicio y carpetas"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$DATA_DIR"
chown "$APP_USER:$APP_USER" "$DATA_DIR"
chmod 700 "$DATA_DIR"

step "Código ($REPO_URL, rama $BRANCH)"
if [[ -d "$APP_DIR/.git" ]]; then
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --quiet --hard "origin/$BRANCH"
else
  mkdir -p "$APP_DIR"
  chown "$APP_USER:$APP_USER" "$APP_DIR"
  sudo -u "$APP_USER" git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

step "Dependencias y compilación (tarda unos minutos en una e2-micro)"
cd "$APP_DIR"
sudo -u "$APP_USER" env HOME="$APP_DIR" npm ci --no-audit --no-fund --loglevel=error
sudo -u "$APP_USER" env HOME="$APP_DIR" NODE_OPTIONS=--max-old-space-size=1536 NEXT_TELEMETRY_DISABLED=1 npm run build

step "Credenciales"
if [[ ! -f "$ENV_FILE" ]]; then
  PASSWORD="$(openssl rand -base64 33 | tr -d '/+=' | cut -c1-28)"
  umask 077
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
PAPER_DATA_DIR=$DATA_DIR
BOT_USER=admin
BOT_PASSWORD=$PASSWORD
EOF
  echo "Contraseña nueva generada."
else
  echo "Se conserva la contraseña existente de $ENV_FILE."
fi
chmod 600 "$ENV_FILE"

step "Servicio systemd"
cat > /etc/systemd/system/solana-bot.service <<EOF
[Unit]
Description=Solana strategy bot (paper)
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
# Listen on loopback only; Caddy is the single public entry point.
ExecStart=/usr/bin/node $APP_DIR/node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port $PORT
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_DIR $APP_DIR/.next

[Install]
WantedBy=multi-user.target
EOF
# Meteora DLMM pool snapshots every 15 min, in its own short-lived process
# with a memory cap so it can never take the trading bot down.
cat > /etc/systemd/system/solana-bot-meteora.service <<EOF
[Unit]
Description=Meteora DLMM pool snapshot (paper research)
After=network-online.target

[Service]
Type=oneshot
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
Environment=NODE_OPTIONS=--max-old-space-size=700
ExecStart=$APP_DIR/node_modules/.bin/tsx scripts/meteora.ts collect
TimeoutStartSec=300
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_DIR
EOF
cat > /etc/systemd/system/solana-bot-meteora.timer <<EOF
[Unit]
Description=Meteora DLMM snapshot every 15 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
Persistent=true

[Install]
WantedBy=timers.target
EOF
# Shortcut: meteora-lp scan | report
cat > /usr/local/bin/meteora-lp <<EOF
#!/usr/bin/env bash
set -a; source $ENV_FILE; set +a
cd $APP_DIR && exec sudo -E -u $APP_USER $APP_DIR/node_modules/.bin/tsx scripts/meteora.ts "\${1:-report}"
EOF
chmod 755 /usr/local/bin/meteora-lp

systemctl daemon-reload
systemctl enable --quiet solana-bot
systemctl restart solana-bot
systemctl enable --quiet --now solana-bot-meteora.timer

step "HTTPS con Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi
if [[ -z "${DOMAIN:-}" ]]; then
  PUBLIC_IP="$(curl -fsS -m 5 -H 'Metadata-Flavor: Google' http://169.254.169.254/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip 2>/dev/null || true)"
  [[ -n "$PUBLIC_IP" ]] || PUBLIC_IP="$(curl -fsS -m 5 https://api.ipify.org)"
  DOMAIN="${PUBLIC_IP//./-}.sslip.io"
fi
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Frame-Options "DENY"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
		-Server
	}
}
EOF
systemctl reload caddy || systemctl restart caddy

# Oracle's Ubuntu images block 80/443 in iptables even when the cloud firewall allows them.
if command -v netfilter-persistent >/dev/null && iptables -S INPUT | grep -q REJECT; then
  for p in 80 443; do
    iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || iptables -I INPUT 5 -p tcp --dport "$p" -j ACCEPT
  done
  netfilter-persistent save >/dev/null
fi

step "Listo"
sleep 3
systemctl --no-pager --lines=0 status solana-bot | head -3
# shellcheck disable=SC1090
source "$ENV_FILE"
cat <<EOF

  Dashboard:  https://$DOMAIN
  Usuario:    $BOT_USER
  Contraseña: $BOT_PASSWORD

  Guarda la contraseña en tu gestor de contraseñas. Para verla de nuevo:
    sudo grep BOT_PASSWORD $ENV_FILE

  El certificado HTTPS puede tardar 1-2 minutos la primera vez.
EOF
