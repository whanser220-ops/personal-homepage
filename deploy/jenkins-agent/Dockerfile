FROM docker:29-cli AS docker-cli

FROM jenkins/inbound-agent:latest-jdk21

USER root

# The long-running Linux Docker Engine exposes its socket as root:docker (0660).
# The dedicated agent joins the matching group so builds stay on that engine.
ARG DOCKER_GID=0

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY github-over-https.conf /etc/ssh/ssh_config.d/20-github-over-https.conf

RUN chmod 0755 /usr/local/bin/docker \
    && chmod 0644 /etc/ssh/ssh_config.d/20-github-over-https.conf \
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
