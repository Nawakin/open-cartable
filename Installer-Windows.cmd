@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
if errorlevel 1 goto setup_error
docker compose version >nul 2>&1
if errorlevel 1 goto docker_error
docker info >nul 2>&1
if errorlevel 1 goto docker_error

if defined OPEN_CARTABLE_LAN_IP if not defined COMPOSE_FILE if exist compose.override.yaml set "COMPOSE_FILE=compose.yaml;compose.override.yaml"
if defined OPEN_CARTABLE_LAN_IP if not defined COMPOSE_FILE set "COMPOSE_FILE=compose.yaml"
if defined OPEN_CARTABLE_LAN_IP set "COMPOSE_FILE=%COMPOSE_FILE%;compose.lan.yaml"
if defined OPEN_CARTABLE_BUILD_CA if not defined COMPOSE_FILE set "COMPOSE_FILE=compose.yaml"
if defined OPEN_CARTABLE_BUILD_CA set "COMPOSE_FILE=%COMPOSE_FILE%;compose.ca.yaml"
docker compose up -d --build --wait --wait-timeout 180
if errorlevel 1 goto compose_error
if not defined OPEN_CARTABLE_LAN_IP goto open_browser
if not exist .local mkdir .local
docker compose cp lan:/data/caddy/pki/authorities/local/root.crt .local/open-cartable-lan-ca.crt
if errorlevel 1 goto setup_error
echo Mode LAN HTTPS. Approuvez le certificat public .local\open-cartable-lan-ca.crt sur votre appareil via un canal sur.

:open_browser
set "APP_URL="
for /f "delims=" %%U in ('docker compose exec -T api node deploy/installation-link.mjs') do set "APP_URL=%%U"
if not defined APP_URL goto setup_error
if defined OPEN_CARTABLE_LAN_IP echo Lien prive pour le navigateur du reseau local. %APP_URL%
start "" "%APP_URL%"
if errorlevel 1 goto setup_error
exit /b 0

:docker_error
echo Demarrez Docker Desktop avec Docker Compose, puis relancez le lanceur.
pause
exit /b 1

:compose_error
docker compose ps -a
docker compose logs --tail=25 secrets

:setup_error
echo Le demarrage a echoue. Consultez les messages Docker ci-dessus puis relancez.
pause
exit /b 1
