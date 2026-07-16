#!/usr/bin/env bash
set -euo pipefail

BRANCH="${BRANCH:-main}"
WEB_ROOT="${WEB_ROOT:-/var/www/personal-homepage}"

cd "$(dirname "$0")/.."

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

npm ci
npm run build

sudo install -d -m 0755 -o www-data -g www-data "$WEB_ROOT"
sudo find "$WEB_ROOT" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
sudo cp -a dist/. "$WEB_ROOT"/
sudo chown -R www-data:www-data "$WEB_ROOT"

echo "Deployed $(git rev-parse --short HEAD) to $WEB_ROOT"
