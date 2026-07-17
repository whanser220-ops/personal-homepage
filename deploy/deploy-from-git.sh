#!/usr/bin/env bash
set -euo pipefail

BRANCH="${BRANCH:-main}"
WEB_ROOT="${WEB_ROOT:-/var/www/personal-homepage}"
BUILD_OUTPUT="${BUILD_OUTPUT:-out}"
REPORT_DATA_SOURCE="${BUNDLE_REPORT_DATA_SOURCE:-/var/www/unity6-bundle-report/data}"
REPORT_DATA_PUBLIC="public/bundle-report-data"

cd "$(dirname "$0")/.."

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

if [ -d "$REPORT_DATA_SOURCE" ]; then
    rm -rf "$REPORT_DATA_PUBLIC"
    mkdir -p "$REPORT_DATA_PUBLIC"
    cp -a "$REPORT_DATA_SOURCE"/. "$REPORT_DATA_PUBLIC"/
    echo "Synced bundle report data from $REPORT_DATA_SOURCE"
else
    echo "Bundle report data source not found: $REPORT_DATA_SOURCE"
fi

npm ci
npm run build

sudo install -d -m 0755 -o www-data -g www-data "$WEB_ROOT"
sudo find "$WEB_ROOT" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
sudo cp -a "$BUILD_OUTPUT"/. "$WEB_ROOT"/
sudo chown -R www-data:www-data "$WEB_ROOT"

echo "Deployed $(git rev-parse --short HEAD) to $WEB_ROOT"
