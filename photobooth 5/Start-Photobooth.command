#!/bin/bash
# Festiq photobooth: dubbelklik dit bestand om alles te starten (Mac).
# Het start de server en een gratis HTTPS-tunnel, zodat de iPad-camera werkt.
cd "$(dirname "$0")" || exit 1
clear
echo "=============================="
echo "   Festiq photobooth starten"
echo "=============================="
echo

# 1. Node.js controleren
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is nog niet geinstalleerd op deze Mac."
  echo "Ik open nu de downloadpagina. Kies de LTS-versie, installeer hem,"
  echo "en dubbelklik daarna nog een keer op dit bestand."
  open "https://nodejs.org/en/download" 2>/dev/null
  echo; read -n 1 -s -r -p "Druk op een toets om te sluiten..."; exit 1
fi

# 2. Onderdelen installeren (alleen de eerste keer)
if [ ! -d node_modules ]; then
  echo "Eerste keer: onderdelen installeren (dit duurt even)..."
  npm install --omit=dev || { echo "Installeren is mislukt. Controleer je internetverbinding."; read -n 1 -s -r -p "Druk op een toets..."; exit 1; }
  echo
fi

# 3. Wachtwoord voor het dashboard (eenmalig)
mkdir -p data
if [ ! -s data/.admin_password ]; then
  echo "Kies een wachtwoord voor het dashboard."
  read -r -s -p "Wachtwoord: " PW; echo
  if [ -z "$PW" ]; then echo "Een wachtwoord is verplicht."; read -n 1 -s -r -p "Druk op een toets..."; exit 1; fi
  printf '%s' "$PW" > data/.admin_password
  chmod 600 data/.admin_password
fi
export ADMIN_PASSWORD="$(cat data/.admin_password)"
export PORT="${PORT:-3000}"

# 4. Gratis HTTPS-tunnel (Cloudflare) klaarzetten
mkdir -p .tools
TUNNEL_BIN=".tools/cloudflared"
if [ ! -x "$TUNNEL_BIN" ]; then
  echo "HTTPS-tunnel downloaden (eenmalig, ongeveer 20 MB)..."
  ARCH="$(uname -m)"
  if [ "$ARCH" = "arm64" ]; then F="cloudflared-darwin-arm64.tgz"; else F="cloudflared-darwin-amd64.tgz"; fi
  if curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/$F" -o .tools/cf.tgz \
     && tar -xzf .tools/cf.tgz -C .tools && chmod +x "$TUNNEL_BIN"; then
    rm -f .tools/cf.tgz
  else
    echo "Tunnel downloaden is niet gelukt; ik ga verder zonder (alleen op deze Mac)."
    rm -f .tools/cf.tgz
  fi
fi

# 5. Alles starten
cleanup() { rm -f data/public_url.txt; [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null; [ -n "$TUN_PID" ] && kill "$TUN_PID" 2>/dev/null; }
trap cleanup EXIT INT TERM

if lsof -i ":$PORT" >/dev/null 2>&1; then
  echo "Poort $PORT is al in gebruik. Staat de photobooth al aan in een ander venster?"
  read -n 1 -s -r -p "Druk op een toets..."; exit 1
fi
rm -f data/public_url.txt
node server.js > data/server.log 2>&1 &
SRV_PID=$!
sleep 2
if ! kill -0 "$SRV_PID" 2>/dev/null; then echo "De server kon niet starten:"; cat data/server.log; read -n 1 -s -r -p "Druk op een toets..."; exit 1; fi

URL=""
if [ -x "$TUNNEL_BIN" ]; then
  echo "HTTPS-adres aanmaken..."
  "$TUNNEL_BIN" tunnel --no-autoupdate --url "http://localhost:$PORT" > data/tunnel.log 2>&1 &
  TUN_PID=$!
  for i in $(seq 1 40); do
    URL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' data/tunnel.log | grep -v '^https://api\.' | head -1)"
    [ -n "$URL" ] && break
    sleep 1
  done
  [ -n "$URL" ] && sleep 4   # even wachten tot het adres bereikbaar is
  [ -n "$URL" ] && printf '%s' "$URL" > data/public_url.txt   # zodat QR-codes altijd naar dit adres wijzen
fi

clear
echo "=============================================="
echo "   Festiq photobooth draait!"
echo "=============================================="
echo
if [ -n "$URL" ]; then
  echo "Open dit adres op je Mac EN op de iPad:"
  echo
  echo "   $URL/admin"
  echo
  echo "Log in met je wachtwoord. Bij elk evenement staat de link naar de booth."
  echo "Gebruik altijd dit adres (niet localhost), dan werken de camera en de QR-codes."
  echo "Let op: dit adres verandert elke keer dat je de photobooth opnieuw start."
  echo
  echo "360-booth op deze Mac? Open die dan via het snelle lokale adres:"
  echo "   http://localhost:$PORT/booth/<naam-van-het-evenement>"
  echo "(de QR-codes voor gasten wijzen toch naar het HTTPS-adres hierboven)."
  open "$URL/admin" 2>/dev/null
else
  echo "Geen HTTPS-adres beschikbaar; alleen op deze Mac:"
  echo "   http://localhost:$PORT/admin"
  echo "(De camera op een iPad werkt alleen via HTTPS.)"
  open "http://localhost:$PORT/admin" 2>/dev/null
fi
echo
echo "Sluit dit venster (of druk op Ctrl+C) om de photobooth te stoppen."
echo "Je foto's en instellingen blijven bewaard in de map 'data'."
wait "$SRV_PID"
