pipeline {
    // Keep the GitHub checkout on the controller, where the warmed Git cache
    // lives. Docker agents receive the source through Jenkins' local stash.
    agent none

    options {
        // A newer main revision supersedes an older deployment. Keeping stale
        // revisions alive only consumes the single Docker agent.
        disableConcurrentBuilds(abortPrevious: true)
        buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '5'))
        skipDefaultCheckout(true)
        timestamps()
        timeout(time: 45, unit: 'MINUTES')
    }

    triggers {
        githubPush()
    }

    environment {
        // The build agent runs on the long-running local Linux Docker Engine.
        // Deploy over SSH while the cloud host only pulls the finished image.
        // Route deployment through the persistent WSL-to-cloud SSH tunnel.
        DEPLOY_HOST = '172.17.0.1'
        DEPLOY_PORT = '10022'
        DEPLOY_PATH = '/opt/personal-homepage'
        APP_NAME = 'personal-homepage'
        REGISTRY_HOST = '127.0.0.1:18081'
        REGISTRY_PROJECT = 'personal-homepage'
        DOCKER_BUILD_PULL = '0'
    }

    stages {
        stage('Prepare GitHub SSH Host Key') {
            agent { label 'built-in' }
            steps {
                sh '''#!/usr/bin/env bash
set -euo pipefail

# The Jenkins Git checkout runs inside an ephemeral Docker agent, so seed
# GitHub's official SSH host keys before the Git plugin verifies known_hosts.
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
cat > "$HOME/.ssh/known_hosts" <<'KNOWN_HOSTS'
github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
[ssh.github.com]:443 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=
github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=
KNOWN_HOSTS
chmod 600 "$HOME/.ssh/known_hosts"
# GitHub SSH over 443 is stable here with the v0 wire protocol; protocol v2
# can stall while receiving the repository pack through the cloud route.
git config --global protocol.version 0
'''
            }
        }

        stage('Record SCM Revision') {
            agent { label 'built-in' }
            steps {
                // Records BuildData so GitHub push webhooks can detect new main revisions.
                retry(3) {
                    checkout([
                        $class: 'GitSCM',
                        branches: [[name: '*/main']],
                        doGenerateSubmoduleConfigurations: false,
                        extensions: [[$class: 'CloneOption', noTags: true, shallow: false]],
                        submoduleCfg: [],
                        userRemoteConfigs: [[
                            credentialsId: 'personal-homepage-github-deploy-key',
                            refspec: '+refs/heads/main:refs/remotes/origin/main',
                            url: 'ssh://git@ssh.github.com:443/whanser220-ops/personal-homepage.git'
                        ]]
                    ])
                }
                sh '''#!/usr/bin/env bash
set -euo pipefail
mkdir -p .ci
printf 'SOURCE_COMMIT_SHA=%s\n' "$(git rev-parse --short HEAD)" > .ci/source.env
'''
                // Do not transfer the controller's Git object database to the agent.
                stash name: 'source', includes: '**/*', excludes: '.git/**', useDefaultExcludes: false
                // Deployment runs on a fresh ephemeral agent, so carry the
                // runtime manifest explicitly instead of relying on stale
                // server-side copies.
                stash name: 'deploy-manifest', includes: 'compose.yml,deploy/deploy-from-image.sh,deploy/nginx-personal-homepage.conf'
            }
        }

        stage('Build and Push Image') {
            agent { label 'personal-homepage-docker-agent' }
            options {
                retry(2)
                timeout(time: 30, unit: 'MINUTES')
            }
            steps {
                deleteDir()
                unstash 'source'
                withCredentials([usernamePassword(
                    credentialsId: 'harbor-personal-homepage',
                    usernameVariable: 'REGISTRY_USERNAME',
                    passwordVariable: 'REGISTRY_PASSWORD'
                )]) {
sh '''#!/usr/bin/env bash
set -euo pipefail

. .ci/source.env
commit_sha="$SOURCE_COMMIT_SHA"
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

# Harbor is the release store; the build engine only needs the latest tag for
# layer reuse. Remove old commit tags for this application so repeated deploys
# cannot slowly fill the local WSL Docker disk.
while IFS= read -r local_image_ref; do
    if [ -n "$local_image_ref" ] && [ "$local_image_ref" != "$latest_image_ref" ]; then
        docker image rm "$local_image_ref" >/dev/null 2>&1 || true
    fi
done < <(docker image ls "$image_repository" --format '{{.Repository}}:{{.Tag}}')
docker image prune --force --filter 'until=168h' >/dev/null 2>&1 || true
'''
                    stash name: 'build-metadata', includes: '.ci/image.env'
                }
            }
        }

        stage('Deploy from Harbor') {
            agent { label 'personal-homepage-docker-agent' }
            options {
                retry(2)
                timeout(time: 20, unit: 'MINUTES')
            }
            steps {
                deleteDir()
                unstash 'deploy-manifest'
                unstash 'build-metadata'
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

deploy_files=(
    compose.yml
    deploy/deploy-from-image.sh
    deploy/nginx-personal-homepage.conf
)
for deploy_file in "${deploy_files[@]}"; do
    if [ ! -f "$deploy_file" ]; then
        echo "Missing deployment file from Jenkins stash: $deploy_file" >&2
        exit 2
    fi
done

# Finish the archive before opening SSH. A failed tar must never leave the
# remote command free to reuse files from a previous deployment.
deploy_archive="$(mktemp)"
cleanup_deploy_archive() {
    rm -f "$deploy_archive"
}
trap cleanup_deploy_archive EXIT
tar -cf "$deploy_archive" "${deploy_files[@]}"

ssh_opts=(
    -i "$DEPLOY_SSH_KEY"
    -p "$DEPLOY_PORT"
    -o IdentitiesOnly=yes
    -o BatchMode=yes
    -o StrictHostKeyChecking=no
    -o ConnectTimeout=10
    -o ServerAliveInterval=10
    -o ServerAliveCountMax=3
)

for attempt in 1 2 3; do
    set +e
    {
        {
            printf '%s\\n%s\\n%s\\n' "$REGISTRY_USERNAME" "$REGISTRY_PASSWORD" "$IMAGE_REF"
            cat "$deploy_archive"
        } | ssh "${ssh_opts[@]}" "$DEPLOY_SSH_USER@$DEPLOY_HOST" \
            "set -eu; read -r REGISTRY_USERNAME; read -r REGISTRY_PASSWORD; read -r APP_IMAGE; mkdir -p '$DEPLOY_PATH'; tar -xf - -C '$DEPLOY_PATH'; export REGISTRY_USERNAME REGISTRY_PASSWORD APP_IMAGE; cd '$DEPLOY_PATH' && chmod +x deploy/deploy-from-image.sh && REGISTRY_HOST='$REGISTRY_HOST' REGISTRY_PROJECT='$REGISTRY_PROJECT' APP_NAME='$APP_NAME' bash deploy/deploy-from-image.sh"
    }
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
            agent { label 'built-in' }
            steps {
                retry(3) {
                sh '''#!/usr/bin/env bash
set -euo pipefail

curl --fail --silent --show-error --connect-timeout 10 --max-time 30 http://1.117.232.198/api/health \
    | grep -q '"ok":true'
curl --fail --silent --show-error --connect-timeout 10 --max-time 30 http://1.117.232.198/ -o homepage.html
grep -q '/_next/static/' homepage.html
for route in about articles projects build-monitor; do
    curl --fail --silent --show-error --connect-timeout 10 --max-time 30 \
        "http://1.117.232.198/$route" -o /dev/null
done
'''
                }
            }
        }
    }
}
