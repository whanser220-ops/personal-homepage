#!/usr/bin/env bash
set -euo pipefail

BRANCH="${BRANCH:-main}"
APP_NAME="${APP_NAME:-personal-homepage}"
CONTAINER_NAME="${CONTAINER_NAME:-personal-homepage}"
HOST_PORT="${HOST_PORT:-3000}"
ENV_FILE="${ENV_FILE:-/etc/personal-homepage/app.env}"
WHITEBOARD_ENV_FILE="${WHITEBOARD_ENV_FILE:-/etc/learning-whiteboard/service.env}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.yml}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-personal-homepage}"
DOCKER_NETWORK="${DOCKER_NETWORK:-personal-homepage-net}"
REGISTRY_HOST="${REGISTRY_HOST:-127.0.0.1:18081}"
REGISTRY_PROJECT="${REGISTRY_PROJECT:-personal-homepage}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-${REGISTRY_HOST}/${REGISTRY_PROJECT}/${APP_NAME}}"
PUSH_IMAGE="${PUSH_IMAGE:-1}"
DOCKER_BUILD_PULL="${DOCKER_BUILD_PULL:-0}"
REGISTRY_AUTH_FILE="${REGISTRY_AUTH_FILE:-/etc/personal-homepage/registry.env}"
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
            WHITEBOARD_IMAGE="$WHITEBOARD_IMAGE" \
            WHITEBOARD_ENV_FILE="$WHITEBOARD_ENV_FILE" \
            docker compose "$@"
    else
        env \
            APP_IMAGE="$image_ref" \
            CONTAINER_NAME="$CONTAINER_NAME" \
            HOST_PORT="$HOST_PORT" \
            ENV_FILE="$ENV_FILE" \
            DOCKER_NETWORK="$DOCKER_NETWORK" \
            WHITEBOARD_IMAGE="$WHITEBOARD_IMAGE" \
            WHITEBOARD_ENV_FILE="$WHITEBOARD_ENV_FILE" \
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

load_registry_credentials() {
    if [ -f "$REGISTRY_AUTH_FILE" ]; then
        if [ -r "$REGISTRY_AUTH_FILE" ]; then
            set -a
            # shellcheck disable=SC1090
            . "$REGISTRY_AUTH_FILE"
            set +a
        elif sudo -n test -r "$REGISTRY_AUTH_FILE" 2>/dev/null; then
            registry_credentials="$(sudo env REGISTRY_AUTH_FILE="$REGISTRY_AUTH_FILE" bash -c '. "$REGISTRY_AUTH_FILE"; printf "%s\n%s\n" "$REGISTRY_USERNAME" "${REGISTRY_PASSWORD:-${REGISTRY_TOKEN:-}}"' bash)"
            REGISTRY_USERNAME="$(printf '%s\n' "$registry_credentials" | sed -n '1p')"
            REGISTRY_PASSWORD="$(printf '%s\n' "$registry_credentials" | sed -n '2p')"
        else
            echo "Registry auth file exists but is not readable: $REGISTRY_AUTH_FILE" >&2
            exit 2
        fi
    fi

    REGISTRY_PASSWORD="${REGISTRY_PASSWORD:-${REGISTRY_TOKEN:-}}"
    if [ -n "${REGISTRY_USERNAME:-}" ] && [ -n "${REGISTRY_PASSWORD:-}" ]; then
        printf '%s' "$REGISTRY_PASSWORD" | docker_cli login \
            --username "$REGISTRY_USERNAME" \
            --password-stdin \
            "$REGISTRY_HOST"
    fi
}

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

commit_sha="$(git rev-parse --short HEAD)"
image_ref="${APP_IMAGE:-${IMAGE_REPOSITORY}:${commit_sha}}"
latest_image_ref="${LATEST_APP_IMAGE:-${IMAGE_REPOSITORY}:latest}"
local_image_ref="${APP_NAME}:${commit_sha}"
local_latest_image_ref="${APP_NAME}:latest"
whiteboard_repository="${REGISTRY_HOST}/${REGISTRY_PROJECT}/learning-whiteboard"
WHITEBOARD_IMAGE="${WHITEBOARD_IMAGE:-${whiteboard_repository}:${image_ref##*:}}"
whiteboard_latest_image_ref="${whiteboard_repository}:latest"
previous_image="$(docker_cli inspect --format '{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"
previous_whiteboard_image="$(docker_cli inspect --format '{{.Config.Image}}' learning-whiteboard 2>/dev/null || true)"

if ! sudo test -f "$ENV_FILE"; then
    echo "Missing runtime env file: $ENV_FILE" >&2
    exit 2
fi

if ! sudo test -s "$WHITEBOARD_ENV_FILE"; then
    echo "Missing whiteboard credentials: $WHITEBOARD_ENV_FILE" >&2
    exit 2
fi
sudo install -d -o 1001 -g 1001 -m 0750 /var/lib/learning-whiteboard

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

load_registry_credentials

build_args=()
if ! is_false "$DOCKER_BUILD_PULL"; then
    build_args+=(--pull)
fi

docker_cli build "${build_args[@]}" \
    -t "$image_ref" \
    -t "$latest_image_ref" \
    -t "$local_image_ref" \
    -t "$local_latest_image_ref" \
    .

docker_cli build "${build_args[@]}" \
    -f services/learning-whiteboard/Dockerfile \
    -t "$WHITEBOARD_IMAGE" \
    -t "$whiteboard_latest_image_ref" \
    .

if ! is_false "$PUSH_IMAGE"; then
    if ! docker_cli push "$image_ref"; then
        echo "Registry push failed for $image_ref. Check REGISTRY_HOST, credentials, and registry reachability." >&2
        exit 1
    fi

    if ! docker_cli push "$latest_image_ref"; then
        echo "Registry push failed for $latest_image_ref. Check REGISTRY_HOST, credentials, and registry reachability." >&2
        exit 1
    fi

    for whiteboard_image_ref in "$WHITEBOARD_IMAGE" "$whiteboard_latest_image_ref"; do
        if ! docker_cli push "$whiteboard_image_ref"; then
            echo "Registry push failed for $whiteboard_image_ref. Check REGISTRY_HOST, credentials, and registry reachability." >&2
            exit 1
        fi
    done
fi

compose_cli -f "$COMPOSE_FILE" config >/dev/null

# Both images were built on this engine. Do not pull here: PUSH_IMAGE=0 keeps
# the manual deployment entry point usable without a registry round trip.
compose_cli -f "$COMPOSE_FILE" up -d --no-build learning-whiteboard
for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error --connect-timeout 2 --max-time 5 \
        http://127.0.0.1:4310/whiteboard/health >/dev/null; then
        break
    fi
    if [ "$attempt" -eq 30 ]; then
        echo "Whiteboard health check failed" >&2
        docker_cli logs --tail 80 learning-whiteboard >&2 || true
        if [ -n "$previous_whiteboard_image" ]; then
            echo "Attempting whiteboard rollback to $previous_whiteboard_image" >&2
            WHITEBOARD_IMAGE="$previous_whiteboard_image" compose_cli -f "$COMPOSE_FILE" up -d --no-build learning-whiteboard || true
        fi
        exit 1
    fi
    sleep 2
done

compose_project="$(docker_cli inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$CONTAINER_NAME" 2>/dev/null || true)"
if [ "$compose_project" = "<no value>" ]; then
    compose_project=""
fi

if [ -n "$compose_project" ] && [ "$compose_project" != "personal-homepage" ]; then
    echo "Container $CONTAINER_NAME belongs to Docker Compose project $compose_project, refusing to replace it." >&2
    exit 2
fi

if [ -z "$compose_project" ] && docker_cli inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
    docker_cli rm -f "$CONTAINER_NAME" >/dev/null
fi

compose_cli -f "$COMPOSE_FILE" up -d --no-build --force-recreate --remove-orphans "$COMPOSE_SERVICE"

for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error "$HEALTH_URL" >/dev/null; then
        break
    fi

    if [ "$attempt" -eq 30 ]; then
        echo "Container health check failed: $HEALTH_URL" >&2
        docker_cli logs --tail 120 "$CONTAINER_NAME" >&2 || true
        compose_cli -f "$COMPOSE_FILE" rm -f -s "$COMPOSE_SERVICE" >/dev/null 2>&1 || true

        if [ -n "$previous_image" ]; then
            echo "Attempting rollback to $previous_image" >&2
            image_ref="$previous_image" compose_cli -f "$COMPOSE_FILE" up -d --no-build --force-recreate "$COMPOSE_SERVICE" || true
        fi

        exit 1
    fi

    sleep 2
done

# Preserve independently maintained TLS routes, including the Study Agent.
nginx_backup="$(mktemp -d)"
sudo cp "$NGINX_CONF_TARGET" "$nginx_backup/http.conf"
sudo cp /etc/nginx/conf.d/study-agent-https.conf "$nginx_backup/https.conf"
had_whiteboard_snippet=0
if sudo test -f /etc/nginx/snippets/learning-whiteboard.conf; then
    had_whiteboard_snippet=1
    sudo cp /etc/nginx/snippets/learning-whiteboard.conf "$nginx_backup/whiteboard.conf"
fi
restore_nginx() {
    sudo cp "$nginx_backup/http.conf" "$NGINX_CONF_TARGET"
    sudo cp "$nginx_backup/https.conf" /etc/nginx/conf.d/study-agent-https.conf
    if [ "$had_whiteboard_snippet" -eq 1 ]; then
        sudo cp "$nginx_backup/whiteboard.conf" /etc/nginx/snippets/learning-whiteboard.conf
    else
        sudo rm -f /etc/nginx/snippets/learning-whiteboard.conf
    fi
    sudo rm -rf "$nginx_backup"
}
if ! { sudo install -D -m 0644 "$NGINX_CONF_SOURCE" "$NGINX_CONF_TARGET" &&
    sudo install -D -m 0644 deploy/nginx-learning-whiteboard.conf /etc/nginx/snippets/learning-whiteboard.conf &&
    sudo python3 deploy/install-whiteboard-nginx.py && sudo nginx -t; }; then
    restore_nginx
    exit 1
fi
sudo systemctl reload nginx
sudo rm -rf "$nginx_backup"

curl --fail --silent --show-error "$HEALTH_URL" >/dev/null
curl --fail --silent --show-error "$METRICS_URL" >/dev/null
curl --fail --silent --show-error https://warmhanser.com/whiteboard/health >/dev/null

echo "Deployed ${commit_sha} as ${image_ref} on 127.0.0.1:${HOST_PORT}"
