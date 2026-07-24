#!/usr/bin/env bash
set -euo pipefail

BRANCH="${BRANCH:-main}"
APP_NAME="${APP_NAME:-personal-homepage}"
CONTAINER_NAME="${CONTAINER_NAME:-personal-homepage}"
HOST_PORT="${HOST_PORT:-3000}"
ENV_FILE="${ENV_FILE:-/etc/personal-homepage/jenkins.env}"
NGINX_CONF_SOURCE="${NGINX_CONF_SOURCE:-deploy/nginx-personal-homepage.conf}"
NGINX_CONF_TARGET="${NGINX_CONF_TARGET:-/etc/nginx/conf.d/personal-homepage.conf}"
HEALTH_URL="http://127.0.0.1:${HOST_PORT}/api/health"

cd "$(dirname "$0")/.."

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

commit_sha="$(git rev-parse --short HEAD)"
image_tag="${IMAGE_TAG:-${APP_NAME}:${commit_sha}}"
previous_image="$(docker inspect --format '{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"

if [ ! -f "$ENV_FILE" ]; then
    echo "Missing runtime env file: $ENV_FILE" >&2
    exit 2
fi

docker build --pull -t "$image_tag" -t "${APP_NAME}:latest" .

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    --env-file "$ENV_FILE" \
    -p "127.0.0.1:${HOST_PORT}:3000" \
    "$image_tag" >/dev/null

for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error "$HEALTH_URL" >/dev/null; then
        break
    fi

    if [ "$attempt" -eq 30 ]; then
        echo "Container health check failed: $HEALTH_URL" >&2
        docker logs --tail 120 "$CONTAINER_NAME" >&2 || true
        docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

        if [ -n "$previous_image" ]; then
            echo "Attempting rollback to $previous_image" >&2
            docker run -d \
                --name "$CONTAINER_NAME" \
                --restart unless-stopped \
                --env-file "$ENV_FILE" \
                -p "127.0.0.1:${HOST_PORT}:3000" \
                "$previous_image" >/dev/null || true
        fi

        exit 1
    fi

    sleep 2
done

sudo install -D -m 0644 "$NGINX_CONF_SOURCE" "$NGINX_CONF_TARGET"
sudo nginx -t
sudo systemctl reload nginx

curl --fail --silent --show-error "$HEALTH_URL" >/dev/null

echo "Deployed ${commit_sha} as ${image_tag} on 127.0.0.1:${HOST_PORT}"
