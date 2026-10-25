#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-personal-homepage}"
CONTAINER_NAME="${CONTAINER_NAME:-personal-homepage}"
HOST_PORT="${HOST_PORT:-3000}"
ENV_FILE="${ENV_FILE:-/etc/personal-homepage/app.env}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.yml}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-personal-homepage}"
DOCKER_NETWORK="${DOCKER_NETWORK:-personal-homepage-net}"
REGISTRY_HOST="${REGISTRY_HOST:-127.0.0.1:18081}"
REGISTRY_PROJECT="${REGISTRY_PROJECT:-personal-homepage}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-${REGISTRY_HOST}/${REGISTRY_PROJECT}/${APP_NAME}}"
APP_IMAGE="${APP_IMAGE:-${IMAGE_REPOSITORY}:latest}"
WHITEBOARD_IMAGE="${WHITEBOARD_IMAGE:-${REGISTRY_HOST}/${REGISTRY_PROJECT}/learning-whiteboard:${APP_IMAGE##*:}}"
WHITEBOARD_ENV_FILE="${WHITEBOARD_ENV_FILE:-/etc/learning-whiteboard/service.env}"
APP_IMAGE_KEEP="${APP_IMAGE_KEEP:-3}"
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
            APP_IMAGE="$APP_IMAGE" \
            CONTAINER_NAME="$CONTAINER_NAME" \
            HOST_PORT="$HOST_PORT" \
            ENV_FILE="$ENV_FILE" \
            DOCKER_NETWORK="$DOCKER_NETWORK" \
            WHITEBOARD_IMAGE="$WHITEBOARD_IMAGE" \
            WHITEBOARD_ENV_FILE="$WHITEBOARD_ENV_FILE" \
            docker compose "$@"
    else
        env \
            APP_IMAGE="$APP_IMAGE" \
            CONTAINER_NAME="$CONTAINER_NAME" \
            HOST_PORT="$HOST_PORT" \
            ENV_FILE="$ENV_FILE" \
            DOCKER_NETWORK="$DOCKER_NETWORK" \
            WHITEBOARD_IMAGE="$WHITEBOARD_IMAGE" \
            WHITEBOARD_ENV_FILE="$WHITEBOARD_ENV_FILE" \
            docker compose "$@"
    fi
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

reclaim_obsolete_build_cache() {
    # Images are built by Jenkins on the local Linux engine. Cloud-side build
    # cache is therefore historical waste and can exhaust this host's small
    # root disk before a pull.
    if ! docker_cli builder prune --all --force >/dev/null; then
        echo "Warning: unable to prune unused Docker builder cache." >&2
    fi
}

prune_old_app_images() {
    if ! [[ "$APP_IMAGE_KEEP" =~ ^[1-9][0-9]*$ ]]; then
        echo "APP_IMAGE_KEEP must be a positive integer." >&2
        return 1
    fi

    local current_id image_ref image_id
    local kept_count=0
    local -A kept_ids=()
    local -a removable_refs=()

    current_id="$(docker_cli image inspect --format '{{.Id}}' "$APP_IMAGE" 2>/dev/null || true)"
    if [ -n "$current_id" ]; then
        kept_ids["$current_id"]=1
        kept_count=1
    fi

    # Docker lists newest images first. Keep the active image plus the newest
    # distinct predecessors so an operator still has immediate rollback tags.
    while read -r image_ref image_id; do
        [ -n "$image_ref" ] || continue
        if [ -n "${kept_ids[$image_id]+x}" ]; then
            continue
        fi

        if [ "$kept_count" -lt "$APP_IMAGE_KEEP" ]; then
            kept_ids["$image_id"]=1
            kept_count=$((kept_count + 1))
        else
            removable_refs+=("$image_ref")
        fi
    done < <(docker_cli image ls --no-trunc "$IMAGE_REPOSITORY" --format '{{.Repository}}:{{.Tag}} {{.ID}}')

    if [ "${#removable_refs[@]}" -gt 0 ]; then
        docker_cli image rm "${removable_refs[@]}" >/dev/null 2>&1 || \
            echo "Warning: some old application image tags could not be removed." >&2
    fi
    docker_cli image prune --force >/dev/null 2>&1 || true
}

previous_image="$(docker_cli inspect --format '{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"
previous_whiteboard_image="$(docker_cli inspect --format '{{.Config.Image}}' learning-whiteboard 2>/dev/null || true)"
monitor_prepared=0
prometheus_prepared=0
exporters_prepared=0
grafana_prepared=0
grafana_history_prepared=0
http_metrics_prepared=0
runtime_switched=0
nginx_backup=""
nginx_changed=0
deployment_exit() {
    local status="$1"
    trap - EXIT
    if [ "$status" -ne 0 ] && [ "$monitor_prepared" -eq 1 ]; then
        set +e
        echo "Restoring monitor installation and previous runtime after failed deployment" >&2
        if [ "$nginx_changed" -eq 1 ] && [ -n "$nginx_backup" ] && [ -d "$nginx_backup" ]; then
            if restore_nginx; then
                sudo nginx -t && sudo systemctl reload nginx
            else
                echo "Nginx rollback could not finish; preserving backup at $nginx_backup" >&2
            fi
        fi
        if [ "$prometheus_prepared" -eq 1 ]; then
            sudo python3 deploy/install-prometheus.py rollback
        fi
        if [ "$http_metrics_prepared" -eq 1 ]; then
            sudo python3 deploy/install-http-metrics.py rollback
        fi
        if [ "$grafana_prepared" -eq 1 ]; then
            sudo python3 deploy/install-grafana.py rollback
        fi
        if [ "$grafana_history_prepared" -eq 1 ]; then
            sudo python3 deploy/install-grafana-history.py rollback
        fi
        if [ "$exporters_prepared" -eq 1 ]; then
            sudo python3 deploy/install-monitor-exporters.py rollback
        fi
        sudo python3 deploy/install-server-monitor.py rollback
        if [ "$runtime_switched" -eq 1 ] && [ -n "$previous_image" ]; then
            APP_IMAGE="$previous_image" WHITEBOARD_IMAGE="${previous_whiteboard_image:-$WHITEBOARD_IMAGE}" \
                compose_cli -f "$COMPOSE_FILE" up -d --no-build --force-recreate "$COMPOSE_SERVICE" learning-whiteboard
        fi
    fi
    if [ "$nginx_changed" -eq 0 ] && [ -n "$nginx_backup" ] && [ -d "$nginx_backup" ]; then
        sudo rm -rf "$nginx_backup"
    fi
    exit "$status"
}
trap 'deployment_exit "$?"' EXIT

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
reclaim_obsolete_build_cache
docker_cli pull "$APP_IMAGE"
docker_cli pull "$WHITEBOARD_IMAGE"
sudo python3 deploy/install-server-monitor.py prepare
monitor_prepared=1
# Prepare the independent private dashboard and its bounded metric log before
# the HTTP exporter starts. No public Grafana route is enabled at this stage.
sudo python3 deploy/install-grafana-history.py prepare
grafana_history_prepared=1
sudo python3 deploy/install-grafana.py prepare
grafana_prepared=1
sudo python3 deploy/verify-grafana-proxy.py
sudo python3 deploy/install-http-metrics.py prepare
http_metrics_prepared=1
# New exporters and a separate Prometheus validate the replacement while the
# existing production Prometheus and full Python exporter keep serving users.
sudo python3 deploy/install-monitor-exporters.py prepare
exporters_prepared=1
# Exercise the actual compiled Next HTTP routes with an isolated in-memory
# session fixture before changing web.env or replacing the production website.
sudo python3 deploy/verify-monitor-runtime.py --image "$APP_IMAGE" --network "$DOCKER_NETWORK" --exporter-mode standard --prometheus-port 19095
# Switch the production scrape/rule configuration only after the separate
# candidate passes. Its transaction never rewrites the old Python program.
sudo python3 deploy/install-prometheus.py prepare
prometheus_prepared=1
sudo python3 deploy/install-prometheus.py cutover
compose_cli -f "$COMPOSE_FILE" config >/dev/null

# Bring the persistent data service up first, before the website switches readers.
runtime_switched=1
compose_cli -f "$COMPOSE_FILE" up -d --no-build learning-whiteboard
for attempt in $(seq 1 30); do
    if curl --fail --silent http://127.0.0.1:4310/whiteboard/health >/dev/null; then
        break
    fi
    if [ "$attempt" -eq 30 ]; then
        echo "Whiteboard health check failed" >&2
        docker_cli logs --tail 80 learning-whiteboard >&2 || true
        if [ -n "$previous_whiteboard_image" ]; then
            echo "Restoring previous whiteboard image" >&2
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

compose_cli -f "$COMPOSE_FILE" up -d --no-build --force-recreate "$COMPOSE_SERVICE"

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
            APP_IMAGE="$previous_image" compose_cli -f "$COMPOSE_FILE" up -d --no-build --force-recreate "$COMPOSE_SERVICE" || true
        fi

        exit 1
    fi

    sleep 2
done

# Preserve independently maintained TLS routes and restore files on validation
# failure so an unrelated later reload cannot activate a broken configuration.
nginx_backup="$(mktemp -d)"
sudo cp "$NGINX_CONF_TARGET" "$nginx_backup/http.conf"
sudo cp /etc/nginx/conf.d/study-agent-https.conf "$nginx_backup/https.conf"
had_whiteboard_snippet=0
had_monitor_snippet=0
had_monitor_http=0
if sudo test -f /etc/nginx/conf.d/00-server-monitor-http.conf; then
    had_monitor_http=1
    sudo cp /etc/nginx/conf.d/00-server-monitor-http.conf "$nginx_backup/monitor-http.conf"
fi
if sudo test -f /etc/nginx/snippets/server-monitor.conf; then
    had_monitor_snippet=1
    sudo cp /etc/nginx/snippets/server-monitor.conf "$nginx_backup/monitor.conf"
fi
if sudo test -f /etc/nginx/snippets/learning-whiteboard.conf; then
    had_whiteboard_snippet=1
    sudo cp /etc/nginx/snippets/learning-whiteboard.conf "$nginx_backup/whiteboard.conf"
fi
restore_nginx() {
    sudo cp "$nginx_backup/http.conf" "$NGINX_CONF_TARGET" || return 1
    sudo cp "$nginx_backup/https.conf" /etc/nginx/conf.d/study-agent-https.conf || return 1
    if [ "$had_monitor_http" -eq 1 ]; then
        sudo cp "$nginx_backup/monitor-http.conf" /etc/nginx/conf.d/00-server-monitor-http.conf || return 1
    else
        sudo rm -f /etc/nginx/conf.d/00-server-monitor-http.conf || return 1
    fi
    if [ "$had_whiteboard_snippet" -eq 1 ]; then
        sudo cp "$nginx_backup/whiteboard.conf" /etc/nginx/snippets/learning-whiteboard.conf || return 1
    else
        sudo rm -f /etc/nginx/snippets/learning-whiteboard.conf || return 1
    fi
    if [ "$had_monitor_snippet" -eq 1 ]; then
        sudo cp "$nginx_backup/monitor.conf" /etc/nginx/snippets/server-monitor.conf || return 1
    else
        sudo rm -f /etc/nginx/snippets/server-monitor.conf || return 1
    fi
    nginx_changed=0
    sudo rm -rf "$nginx_backup"
}
nginx_changed=1
if ! { sudo install -D -m 0644 "$NGINX_CONF_SOURCE" "$NGINX_CONF_TARGET" &&
    sudo install -D -m 0644 deploy/nginx-monitor-http.conf /etc/nginx/conf.d/00-server-monitor-http.conf &&
    sudo install -D -m 0644 deploy/nginx-learning-whiteboard.conf /etc/nginx/snippets/learning-whiteboard.conf &&
    sudo install -D -m 0644 deploy/nginx-server-monitor.conf /etc/nginx/snippets/server-monitor.conf &&
    sudo python3 deploy/install-whiteboard-nginx.py &&
    sudo python3 deploy/install-monitor-nginx.py && sudo nginx -t; }; then
    restore_nginx
    exit 1
fi
sudo systemctl reload nginx
sudo python3 deploy/install-server-monitor.py activate

curl --fail --silent --show-error "$HEALTH_URL" >/dev/null
curl --fail --silent --show-error "$METRICS_URL" >/dev/null
curl --fail --silent --show-error https://warmhanser.com/whiteboard/health >/dev/null
sudo python3 deploy/verify-server-monitor.py
sudo python3 deploy/verify-grafana.py
# Only retire the push collector after the website, login configuration,
# private reads and Prometheus samples have all passed release verification.
sudo python3 deploy/install-prometheus.py finalize
sudo python3 deploy/install-monitor-exporters.py finalize
sudo python3 deploy/install-monitor-exporters.py commit
exporters_prepared=0
sudo python3 deploy/install-http-metrics.py commit
http_metrics_prepared=0
sudo python3 deploy/install-grafana.py commit
grafana_prepared=0
sudo python3 deploy/install-grafana-history.py commit
grafana_history_prepared=0
sudo python3 deploy/install-prometheus.py commit
prometheus_prepared=0
sudo python3 deploy/install-server-monitor.py commit
monitor_prepared=0
sudo rm -rf "$nginx_backup"
prune_old_app_images || echo "Warning: application image cleanup did not complete." >&2
IMAGE_REPOSITORY="${REGISTRY_HOST}/${REGISTRY_PROJECT}/learning-whiteboard" APP_IMAGE="$WHITEBOARD_IMAGE" prune_old_app_images || \
    echo "Warning: whiteboard image cleanup did not complete." >&2

echo "Deployed ${APP_IMAGE} on 127.0.0.1:${HOST_PORT}"
