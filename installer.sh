#!/bin/sh
set -eu
cd -- "$(dirname -- "$0")"

if ! docker compose version >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "Démarrez Docker avec le plugin Docker Compose, puis relancez l’installateur." >&2
  exit 1
fi

if [ -n "${OPEN_CARTABLE_LAN_IP:-}" ]; then
  if [ -z "${COMPOSE_FILE:-}" ] && [ -f compose.override.yaml ]; then
    COMPOSE_FILE=compose.yaml:compose.override.yaml
  fi
  export COMPOSE_FILE="${COMPOSE_FILE:-compose.yaml}:compose.lan.yaml"
fi

if [ -n "${OPEN_CARTABLE_BUILD_CA:-}" ]; then
  if [ -z "${COMPOSE_FILE:-}" ] && [ -f compose.override.yaml ]; then
    COMPOSE_FILE=compose.yaml:compose.override.yaml
  fi
  export COMPOSE_FILE="${COMPOSE_FILE:-compose.yaml}:compose.ca.yaml"
fi
if ! docker compose up -d --build --wait --wait-timeout 180; then
  docker compose ps -a >&2 || true
  docker compose logs --tail=25 secrets >&2 || true
  echo "Vérifiez l’état des services ci-dessus et relancez le lanceur après correction." >&2
  exit 1
fi
if [ -n "${OPEN_CARTABLE_LAN_IP:-}" ]; then
  mkdir -p .local
  docker compose cp lan:/data/caddy/pki/authorities/local/root.crt .local/open-cartable-lan-ca.crt
  printf 'Mode LAN HTTPS · certificat public à approuver sur votre appareil via un canal sûr\n%s\n' "$(pwd)/.local/open-cartable-lan-ca.crt"
fi
url=$(docker compose exec -T api node deploy/installation-link.mjs)
if [ -n "${OPEN_CARTABLE_LAN_IP:-}" ]; then
  printf 'Ouvrez ce lien privé dans le navigateur de l’appareil choisi sur le réseau local.\n%s\n' "$url"
fi
if [ "$(uname -s)" = Darwin ]; then
  open "$url" && exit 0
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$url" && exit 0
fi
printf 'Ouvrez ce lien dans votre navigateur local. Gardez-le privé pendant l’installation.\n%s\n' "$url"
