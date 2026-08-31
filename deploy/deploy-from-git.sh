#!/usr/bin/env bash
set -euo pipefail

BRANCH="${BRANCH:-main}"
APP_NAME="${APP_NAME:-personal-homepage}"
CONTAINER_NAME="${CONTAINER_NAME:-personal-homepage}"
HOST_PORT="${HOST_PORT:-3000}"
ENV_FILE="${ENV_FILE:-/etc/personal-homepage/app.env}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.yml}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-personal-homepage}"
DOCKER_NETWORK="${DOCKER_NETWORK:-personal-homepage-net}"
DOCKER_IMAGE_REPOSITORY="${DOCKER_IMAGE_REPOSITORY:-whanser220/whanser}"
DOCKER_IMAGE_TAG_PREFIX="${DOCKER_IMAGE_TAG_PREFIX:-personal-homepage}"
PUSH_IMAGE="${PUSH_IMAGE:-1}"
DOCKERHUB_AUTH_FILE="${DOCKERHUB_AUTH_FILE:-/etc/personal-homepage/dockerhub.env}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-personal-homepage-postgres}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine}"
POSTGRES_VOLUME="${POSTGRES_VOLUME:-personal_homepage_pgdata}"
NGINX_CONF_SOURCE="${NGINX_CONF_SOURCE:-deploy/nginx-personal-homepage.conf}"
NGINX_CONF_TARGET="${NGINX_CONF_TARGET:-/etc/nginx/conf.d/personal-homepage.conf}"
HEALTH_URL="http://127.0.0.1:${HOST_PORT}/api/health"
METRICS_URL="http://127.0.0.1:${HOST_PORT}/api/build-metrics/runs/latest"

cd "$(dirname "$0")/.."

USE_SUDO_DOCKER=0
if sudo -n docker ps >/dev/null 2>&1; then
    USE_SUDO_DOCKER=1
elif docker ps >/dev/null 2>&1; then
    USE_SUDO_DOCKER=0
else
    echo "Current user cannot access Docker, and passwordless sudo docker is unavailable." >&2
    exit 2
fi

docker_cli() {
    if [ "$USE_SUDO_DOCKER" -eq 1 ]; then
        sudo docker "$@"
    else
        docker "$@"
    fi
}

compose_cli() {
    if [ "$USE_SUDO_DOCKER" -eq 1 ]; then
        sudo env \
            APP_IMAGE="$image_ref" \
            CONTAINER_NAME="$CONTAINER_NAME" \
            HOST_PORT="$HOST_PORT" \
            ENV_FILE="$ENV_FILE" \
            DOCKER_NETWORK="$DOCKER_NETWORK" \
            COMPOSE_SERVICE="$COMPOSE_SERVICE" \
            docker compose "$@"
    else
        env \
            APP_IMAGE="$image_ref" \
            CONTAINER_NAME="$CONTAINER_NAME" \
            HOST_PORT="$HOST_PORT" \
            ENV_FILE="$ENV_FILE" \
            DOCKER_NETWORK="$DOCKER_NETWORK" \
            COMPOSE_SERVICE="$COMPOSE_SERVICE" \
            docker compose "$@"
    fi
}

is_false() {
    case "$1" in
        0|false|False|FALSE|no|No|NO)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

load_dockerhub_credentials() {
    if [ -f "$DOCKERHUB_AUTH_FILE" ]; then
        if [ -r "$DOCKERHUB_AUTH_FILE" ]; then
            set -a
            # shellcheck disable=SC1090
            . "$DOCKERHUB_AUTH_FILE"
            set +a
        elif sudo -n test -r "$DOCKERHUB_AUTH_FILE" 2>/dev/null; then
            DOCKERHUB_USERNAME="$(sudo awk -F= '$1 == "DOCKERHUB_USERNAME" { sub(/^DOCKERHUB_USERNAME=/, ""); print; exit }' "$DOCKERHUB_AUTH_FILE")"
            DOCKERHUB_TOKEN="$(sudo awk -F= '$1 == "DOCKERHUB_TOKEN" { sub(/^DOCKERHUB_TOKEN=/, ""); print; exit }' "$DOCKERHUB_AUTH_FILE")"
        else
            echo "Docker Hub auth file exists but is not readable: $DOCKERHUB_AUTH_FILE" >&2
            exit 2
        fi
    fi

    if [ -n "${DOCKERHUB_USERNAME:-}" ] && [ -n "${DOCKERHUB_TOKEN:-}" ]; then
        printf '%s' "$DOCKERHUB_TOKEN" | docker_cli login \
            --username "$DOCKERHUB_USERNAME" \
            --password-stdin
    fi
}

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

commit_sha="$(git rev-parse --short HEAD)"
image_ref="${APP_IMAGE:-${DOCKER_IMAGE_REPOSITORY}:${DOCKER_IMAGE_TAG_PREFIX}-${commit_sha}}"
latest_image_ref="${LATEST_APP_IMAGE:-${DOCKER_IMAGE_REPOSITORY}:${DOCKER_IMAGE_TAG_PREFIX}-latest}"
local_image_ref="${APP_NAME}:${commit_sha}"
local_latest_image_ref="${APP_NAME}:latest"
previous_image="$(docker_cli inspect --format '{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"

if ! sudo test -f "$ENV_FILE"; then
    echo "Missing runtime env file: $ENV_FILE" >&2
    exit 2
fi

database_url="$(sudo awk -F= '$1 == "DATABASE_URL" { sub(/^DATABASE_URL=/, ""); print; exit }' "$ENV_FILE")"
if [ -z "$database_url" ]; then
    echo "DATABASE_URL is required in $ENV_FILE" >&2
    exit 2
fi

build_metrics_token="$(sudo awk -F= '$1 == "BUILD_METRICS_INGEST_TOKEN" { sub(/^BUILD_METRICS_INGEST_TOKEN=/, ""); print; exit }' "$ENV_FILE")"
if [ -z "$build_metrics_token" ]; then
    echo "BUILD_METRICS_INGEST_TOKEN is required in $ENV_FILE" >&2
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

if [ ! -f "$COMPOSE_FILE" ]; then
    echo "Missing Docker Compose file: $COMPOSE_FILE" >&2
    exit 2
fi

docker_cli network create "$DOCKER_NETWORK" >/dev/null 2>&1 || true
if docker_cli inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1; then
    docker_cli start "$POSTGRES_CONTAINER" >/dev/null
    docker_cli network connect "$DOCKER_NETWORK" "$POSTGRES_CONTAINER" >/dev/null 2>&1 || true
else
    docker_cli run -d \
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
    if docker_cli exec "$POSTGRES_CONTAINER" pg_isready -U "$postgres_user" -d "$postgres_db" >/dev/null 2>&1; then
        break
    fi

    if [ "$attempt" -eq 60 ]; then
        echo "PostgreSQL readiness check failed." >&2
        docker_cli logs --tail 120 "$POSTGRES_CONTAINER" >&2 || true
        exit 1
    fi

    sleep 2
done

docker_cli build --pull \
    -t "$image_ref" \
    -t "$latest_image_ref" \
    -t "$local_image_ref" \
    -t "$local_latest_image_ref" \
    .

if ! is_false "$PUSH_IMAGE"; then
    load_dockerhub_credentials
    if ! docker_cli push "$image_ref"; then
        echo "Docker Hub push failed for $image_ref. Configure docker login or $DOCKERHUB_AUTH_FILE." >&2
        exit 1
    fi
    if ! docker_cli push "$latest_image_ref"; then
        echo "Docker Hub push failed for $latest_image_ref. Configure docker login or $DOCKERHUB_AUTH_FILE." >&2
        exit 1
    fi
fi

compose_cli -f "$COMPOSE_FILE" config >/dev/null

compose_project="$(docker_cli inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$CONTAINER_NAME" 2>/dev/null || true)"
if docker_cli inspect "$CONTAINER_NAME" >/dev/null 2>&1 && { [ -z "$compose_project" ] || [ "$compose_project" = "<no value>" ]; }; then
    docker_cli rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
fi

compose_cli -f "$COMPOSE_FILE" up -d --no-build --force-recreate --remove-orphans "$COMPOSE_SERVICE"

for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error "$HEALTH_URL" >/dev/null; then
        break
    fi

    if [ "$attempt" -eq 30 ]; then
        echo "Container health check failed: $HEALTH_URL" >&2
        docker_cli logs --tail 120 "$CONTAINER_NAME" >&2 || true

        if [ -n "$previous_image" ]; then
            echo "Attempting rollback to $previous_image" >&2
            image_ref="$previous_image"
            compose_cli -f "$COMPOSE_FILE" up -d --no-build --force-recreate "$COMPOSE_SERVICE" || true
        fi

        exit 1
    fi

    sleep 2
done

sudo install -D -m 0644 "$NGINX_CONF_SOURCE" "$NGINX_CONF_TARGET"
sudo nginx -t
sudo systemctl reload nginx

curl --fail --silent --show-error "$HEALTH_URL" >/dev/null
curl --fail --silent --show-error "$METRICS_URL" >/dev/null

echo "Deployed ${commit_sha} as ${image_ref} via Docker Compose on 127.0.0.1:${HOST_PORT}"
