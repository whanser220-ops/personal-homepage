pipeline {
    agent { label 'built-in' }

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
        DEPLOY_HOST = '1.117.232.198'
        DEPLOY_PATH = '/opt/personal-homepage'
        DEPLOY_BRANCH = 'main'
    }

    stages {
        stage('Deploy from Git') {
            steps {
                withCredentials([sshUserPrivateKey(
                    credentialsId: 'bundle-report-ssh-key',
                    keyFileVariable: 'DEPLOY_SSH_KEY',
                    usernameVariable: 'DEPLOY_SSH_USER'
                )]) {
                    sh '''#!/usr/bin/env bash
set -euo pipefail

ssh -i "$DEPLOY_SSH_KEY" \
    -o IdentitiesOnly=yes \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=no \
    -o ConnectTimeout=10 \
    -o ServerAliveInterval=10 \
    -o ServerAliveCountMax=3 \
    "$DEPLOY_SSH_USER@$DEPLOY_HOST" \
    "cd '$DEPLOY_PATH' && BRANCH='$DEPLOY_BRANCH' bash deploy/deploy-from-git.sh"
'''
                }
            }
        }

        stage('Verify Site') {
            steps {
                sh '''#!/usr/bin/env bash
set -euo pipefail

curl --fail --silent --show-error http://1.117.232.198/ -o homepage.html
grep -q '/assets/index-' homepage.html
'''
            }
        }
    }
}
