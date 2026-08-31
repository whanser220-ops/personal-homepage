FROM docker:29-cli AS docker-cli

FROM jenkins/inbound-agent:latest-jdk21

USER root

ARG DOCKER_GID=988

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

RUN chmod 0755 /usr/local/bin/docker \
    && if getent group "${DOCKER_GID}" >/dev/null; then \
        usermod -aG "$(getent group "${DOCKER_GID}" | cut -d: -f1)" jenkins; \
    elif getent group docker >/dev/null; then \
        groupmod -g "${DOCKER_GID}" docker; \
        usermod -aG docker jenkins; \
    else \
        groupadd -g "${DOCKER_GID}" docker; \
        usermod -aG docker jenkins; \
    fi

USER jenkins
