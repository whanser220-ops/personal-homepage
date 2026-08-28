pipeline {
    agent { label 'personal-homepage-docker-agent' }

    options {
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
        timestamps()
    }

    triggers {
        githubPush()
        pollSCM('H/2 * * * *')
    }

    environment {
        DEPLOY_HOST = '172.17.0.1'
        DEPLOY_PATH = '/opt/personal-homepage'
        DEPLOY_BRANCH = 'main'
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
                checkout scm
            }
        }

        stage('Deploy from Git') {
            steps {
                withCredentials([sshUserPrivateKey(
                    credentialsId: 'bundle-report-ssh-key',
                    keyFileVariable: 'DEPLOY_SSH_KEY',
                    usernameVariable: 'DEPLOY_SSH_USER'
                )]) {
sh '''#!/usr/bin/env bash
set -euo pipefail

for attempt in 1 2 3; do
    set +e
    ssh -i "$DEPLOY_SSH_KEY" \
        -o IdentitiesOnly=yes \
        -o BatchMode=yes \
        -o StrictHostKeyChecking=no \
        -o ConnectTimeout=10 \
        -o ServerAliveInterval=10 \
        -o ServerAliveCountMax=3 \
        "$DEPLOY_SSH_USER@$DEPLOY_HOST" \
        "cd '$DEPLOY_PATH' && git fetch origin '$DEPLOY_BRANCH' && git checkout '$DEPLOY_BRANCH' && git pull --ff-only origin '$DEPLOY_BRANCH' && BRANCH='$DEPLOY_BRANCH' bash deploy/deploy-from-git.sh"
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
