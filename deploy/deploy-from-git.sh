#!/usr/bin/env bash
set -euo pipefail

BRANCH="${BRANCH:-main}"
APP_NAME="${APP_NAME:-personal-homepage}"
CONTAINER_NAME="${CONTAINER_NAME:-personal-homepage}"
HOST_PORT="${HOST_PORT:-3000}"
ENV_FILE="${ENV_FILE:-/etc/personal-homepage/app.env}"
DOCKER_NETWORK="${DOCKER_NETWORK:-personal-homepage-net}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-personal-homepage-postgres}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine}"
POSTGRES_VOLUME="${POSTGRES_VOLUME:-personal_homepage_pgdata}"
NGINX_CONF_SOURCE="${NGINX_CONF_SOURCE:-deploy/nginx-personal-homepage.conf}"
NGINX_CONF_TARGET="${NGINX_CONF_TARGET:-/etc/nginx/conf.d/personal-homepage.conf}"
HEALTH_URL="http://127.0.0.1:${HOST_PORT}/api/health"
PROGRESS_URL="http://127.0.0.1:${HOST_PORT}/api/build-progress"

cd "$(dirname "$0")/.."

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

commit_sha="$(git rev-parse --short HEAD)"
image_tag="${IMAGE_TAG:-${APP_NAME}:${commit_sha}}"
previous_image="$(sudo docker inspect --format '{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"

if ! sudo test -f "$ENV_FILE"; then
    echo "Missing runtime env file: $ENV_FILE" >&2
    exit 2
fi

database_url="$(sudo awk -F= '$1 == "DATABASE_URL" { sub(/^DATABASE_URL=/, ""); print; exit }' "$ENV_FILE")"
if [ -z "$database_url" ]; then
    echo "DATABASE_URL is required in $ENV_FILE" >&2
    exit 2
fi

database_without_scheme="${database_url#*://}"
database_auth="${database_without_scheme%%@*}"
postgres_user="${database_auth%%:*}"
postgres_password="${database_auth#*:}"
database_after_host="${database_without_scheme#*@}"
database_path="${database_after_host#*/}"
postgres_db="${database_path%%\?*}"

if [ -z "$postgres_user" ] || [ -z "$postgres_password" ] || [ -z "$postgres_db" ]; then
    echo "Failed to parse PostgreSQL credentials from DATABASE_URL." >&2
    exit 2
fi

sudo docker network create "$DOCKER_NETWORK" >/dev/null 2>&1 || true
if sudo docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1; then
    sudo docker start "$POSTGRES_CONTAINER" >/dev/null
    sudo docker network connect "$DOCKER_NETWORK" "$POSTGRES_CONTAINER" >/dev/null 2>&1 || true
else
    sudo docker run -d \
        --name "$POSTGRES_CONTAINER" \
        --restart unless-stopped \
        --network "$DOCKER_NETWORK" \
        -v "${POSTGRES_VOLUME}:/var/lib/postgresql/data" \
        -e "POSTGRES_USER=${postgres_user}" \
        -e "POSTGRES_PASSWORD=${postgres_password}" \
        -e "POSTGRES_DB=${postgres_db}" \
        "$POSTGRES_IMAGE" >/dev/null
fi

for attempt in $(seq 1 60); do
    if sudo docker exec "$POSTGRES_CONTAINER" pg_isready -U "$postgres_user" -d "$postgres_db" >/dev/null 2>&1; then
        break
    fi

    if [ "$attempt" -eq 60 ]; then
        echo "PostgreSQL readiness check failed." >&2
        sudo docker logs --tail 120 "$POSTGRES_CONTAINER" >&2 || true
        exit 1
    fi

    sleep 2
done

sudo docker build --pull -t "$image_tag" -t "${APP_NAME}:latest" .

sudo docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
sudo docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    --network "$DOCKER_NETWORK" \
    --env-file "$ENV_FILE" \
    -p "127.0.0.1:${HOST_PORT}:3000" \
    "$image_tag" >/dev/null

for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error "$HEALTH_URL" >/dev/null; then
        break
    fi

    if [ "$attempt" -eq 30 ]; then
        echo "Container health check failed: $HEALTH_URL" >&2
        sudo docker logs --tail 120 "$CONTAINER_NAME" >&2 || true
        sudo docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

        if [ -n "$previous_image" ]; then
            echo "Attempting rollback to $previous_image" >&2
            sudo docker run -d \
                --name "$CONTAINER_NAME" \
                --restart unless-stopped \
                --network "$DOCKER_NETWORK" \
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
curl --fail --silent --show-error "$PROGRESS_URL" >/dev/null

echo "Deployed ${commit_sha} as ${image_tag} on 127.0.0.1:${HOST_PORT}"
