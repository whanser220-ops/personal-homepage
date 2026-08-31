pipeline {
    agent { label 'personal-homepage-docker-agent' }

    options {
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
        timestamps()
    }

    triggers {
        githubPush()
    }

    environment {
        DEPLOY_HOST = '172.17.0.1'
        DEPLOY_PATH = '/opt/personal-homepage'
        APP_NAME = 'personal-homepage'
        REGISTRY_HOST = '127.0.0.1:18081'
        REGISTRY_PROJECT = 'personal-homepage'
        DOCKER_BUILD_PULL = '0'
    }

    stages {
        stage('Prepare GitHub SSH Host Key') {
            steps {
                sh '''#!/usr/bin/env bash
set -euo pipefail

# The Jenkins Git checkout runs inside an ephemeral Docker agent, so seed
# GitHub's official SSH host keys before the Git plugin verifies known_hosts.
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
cat > "$HOME/.ssh/known_hosts" <<'KNOWN_HOSTS'
github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=
github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=
KNOWN_HOSTS
chmod 600 "$HOME/.ssh/known_hosts"
'''
            }
        }

        stage('Record SCM Revision') {
            steps {
                // Records BuildData so GitHub push webhooks can detect new main revisions.
                retry(3) {
                    checkout scm
                }
            }
        }

        stage('Build and Push Image') {
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'harbor-personal-homepage',
                    usernameVariable: 'REGISTRY_USERNAME',
                    passwordVariable: 'REGISTRY_PASSWORD'
                )]) {
sh '''#!/usr/bin/env bash
set -euo pipefail

commit_sha="$(git rev-parse --short HEAD)"
image_repository="${REGISTRY_HOST}/${REGISTRY_PROJECT}/${APP_NAME}"
image_ref="${image_repository}:${commit_sha}"
latest_image_ref="${image_repository}:latest"

mkdir -p .ci
cat > .ci/image.env <<EOF
COMMIT_SHA=${commit_sha}
IMAGE_REF=${image_ref}
LATEST_IMAGE_REF=${latest_image_ref}
EOF

docker version

docker_config="$(mktemp -d)"
cleanup() {
    rm -rf "$docker_config"
}
trap cleanup EXIT
export DOCKER_CONFIG="$docker_config"

auth="$(printf '%s:%s' "$REGISTRY_USERNAME" "$REGISTRY_PASSWORD" | base64 | tr -d '\\n')"
cat > "$DOCKER_CONFIG/config.json" <<EOF
{"auths":{"${REGISTRY_HOST}":{"auth":"${auth}"}}}
EOF

build_args=()
case "${DOCKER_BUILD_PULL:-0}" in
    0|false|False|FALSE|no|No|NO) ;;
    *) build_args+=(--pull) ;;
esac

docker build "${build_args[@]}" \
    -t "$image_ref" \
    -t "$latest_image_ref" \
    .

docker push "$image_ref"
docker push "$latest_image_ref"
'''
                }
            }
        }

        stage('Deploy from Harbor') {
            steps {
                withCredentials([
                    sshUserPrivateKey(
                        credentialsId: 'bundle-report-ssh-key',
                        keyFileVariable: 'DEPLOY_SSH_KEY',
                        usernameVariable: 'DEPLOY_SSH_USER'
                    ),
                    usernamePassword(
                        credentialsId: 'harbor-personal-homepage',
                        usernameVariable: 'REGISTRY_USERNAME',
                        passwordVariable: 'REGISTRY_PASSWORD'
                    )
                ]) {
sh '''#!/usr/bin/env bash
set -euo pipefail

. .ci/image.env

ssh_opts=(
    -i "$DEPLOY_SSH_KEY"
    -o IdentitiesOnly=yes
    -o BatchMode=yes
    -o StrictHostKeyChecking=no
    -o ConnectTimeout=10
    -o ServerAliveInterval=10
    -o ServerAliveCountMax=3
)

ssh "${ssh_opts[@]}" "$DEPLOY_SSH_USER@$DEPLOY_HOST" \
    "mkdir -p '$DEPLOY_PATH/deploy'"

scp "${ssh_opts[@]}" compose.yml \
    "$DEPLOY_SSH_USER@$DEPLOY_HOST:$DEPLOY_PATH/compose.yml"

scp "${ssh_opts[@]}" deploy/deploy-from-image.sh deploy/nginx-personal-homepage.conf \
    "$DEPLOY_SSH_USER@$DEPLOY_HOST:$DEPLOY_PATH/deploy/"

for attempt in 1 2 3; do
    set +e
    printf '%s\\n%s\\n%s\\n' "$REGISTRY_USERNAME" "$REGISTRY_PASSWORD" "$IMAGE_REF" | ssh "${ssh_opts[@]}" \
        "$DEPLOY_SSH_USER@$DEPLOY_HOST" \
        "set -eu; read -r REGISTRY_USERNAME; read -r REGISTRY_PASSWORD; read -r APP_IMAGE; export REGISTRY_USERNAME REGISTRY_PASSWORD APP_IMAGE; cd '$DEPLOY_PATH' && chmod +x deploy/deploy-from-image.sh && REGISTRY_HOST='$REGISTRY_HOST' REGISTRY_PROJECT='$REGISTRY_PROJECT' APP_NAME='$APP_NAME' bash deploy/deploy-from-image.sh"
    status="$?"
    set -e

    if [ "$status" -eq 0 ]; then
        exit 0
    fi

    if [ "$attempt" -eq 3 ]; then
        echo "Deploy attempt $attempt failed with exit code $status" >&2
        exit "$status"
    fi

    echo "Deploy attempt $attempt failed with exit code $status; retrying in 60s" >&2
    sleep 60
done
'''
                }
            }
        }

        stage('Verify Site') {
            steps {
                sh '''#!/usr/bin/env bash
set -euo pipefail

curl --fail --silent --show-error http://1.117.232.198/ -o homepage.html
grep -q '/_next/static/' homepage.html
'''
            }
        }
    }
}
