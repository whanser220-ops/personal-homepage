# 本机 Jenkins 控制器

个人网站的 Jenkins 控制器运行在本机 WSL 发行版 `DockerEngine` 中。云服务器保留原 Jenkins 地址，转发 UI、API 和 GitHub Webhook；网站生产容器仍在云服务器运行。

## 请求与执行链路

```text
GitHub main push / 浏览器 / Jenkins API
  -> http://1.117.232.198:8080/
  -> 云服务器 Nginx :8080
  -> 云端 loopback 127.0.0.1:18082
  -> 本机发起的反向 SSH 隧道
  -> WSL DockerEngine 的 :18080
  -> 本机 Jenkins 控制器
  -> 本机 Docker socket 创建临时 Agent
  -> Agent 通过 172.17.0.1:18080 使用 WebSocket 连接控制器
```

全局 Jenkins URL 保持 `http://1.117.232.198:8080/`，GitHub Webhook 保持 `http://1.117.232.198:8080/github-webhook/`。Agent 使用本机 Docker 网桥地址，避免经过云服务器再返回本机。

构建、镜像和部署分工：

| 位置 | 组件与职责 |
| --- | --- |
| 本机 WSL `DockerEngine` | Jenkins 控制器保存任务、凭据、构建记录并调度任务 |
| 同一个本机 Docker Engine | 创建临时 Agent，执行镜像构建并推送 Harbor |
| 本机 Harbor `:18081` | 保存构建出的镜像 |
| 云服务器 Docker | 从反向隧道 `127.0.0.1:18081` 拉取镜像，启动网站容器 |
| 本机到云端的 SSH 部署隧道 | Agent 访问 `172.17.0.1:10022`，到达云服务器 SSH `:22` |

`Jenkinsfile` 的 `personal-homepage-deploy` 流程和现有凭据 ID 保持兼容。源码由控制器检出，工作文件通过 stash 传给临时 Agent；构建、推送、部署仍由对应阶段执行。

Git 插件记录的仓库 URL 使用 `git@github.com:whanser220-ops/personal-homepage.git`，保持与 GitHub Webhook 的仓库身份一致。控制器的 Git 配置仅将这个仓库的 SSH 传输改写到 `ssh://git@ssh.github.com/whanser220-ops/personal-homepage.git`；容器 SSH 配置再将 `ssh.github.com` 连接到 WSL 网桥 `172.17.0.1:14443`，经云服务器到达真正的 `ssh.github.com:443`。SSH 使用 `HostKeyAlias [ssh.github.com]:443` 和已有 GitHub 主机密钥严格校验。

不要将 `ssh.github.com` 传输地址写成 Jenkins SCM URL，否则 GitHub 事件无法按 `github.com` 匹配推送。Git 传输改写 URL 也不要显式携带 `:443`，避免 Git 生成的 `ssh -p 443` 覆盖容器 SSH 配置里的本机隧道端口。

## 运行状态与数据边界

迁移保留 Jenkins `2.555.3` 和原控制器镜像，避免迁移同时升级 Jenkins 或插件。运行定义位于 WSL Linux 文件系统：

| 对象 | 名称或路径 |
| --- | --- |
| 控制器容器 | `jenkins-controller` |
| Compose 文件 | `/opt/jenkins-controller/compose.yml` |
| 控制器 systemd 服务 | `jenkins-controller.service` |
| Home 宿主目录 | `/opt/jenkins-controller/jenkins_home`，bind 到容器 `/var/jenkins_home` |
| 控制器反向隧道服务 | `jenkins-tunnel-local-controller.service` |

Jenkins Docker Cloud 保留历史名称 `local-docker-desktop`，其 Docker URI 改为 `unix:///var/run/docker.sock`。这个历史名称不表示仍在使用 Docker Desktop。

Home 宿主目录包含任务配置、构建记录、插件、用户及凭据解密材料。不要将它复制进网站仓库或公开产物，也不要把它改成 Windows 挂载目录下的普通项目文件夹。

云端 Nginx 配置是 `/etc/nginx/conf.d/jenkins-wsl.conf`，代理 upstream 为 `127.0.0.1:18082`；保留 Host、Forwarded 头与 WebSocket Upgrade，连接超时设为长请求可用。`18082` 只监听云端 loopback。

网站 `/server-monitor` 继续通过云端 `http://127.0.0.1:8080/login` 检查 Jenkins HTTP 健康。留作回退的云端旧 Jenkins 容器从当前容器采样名单移除，避免将正常归档的退出状态显示成当前控制器故障；网站、白板和 PostgreSQL 的云端容器监控继续保留。

当前通道：

| 通道 | WSL 服务/云端入口 | 用途 |
| --- | --- | --- |
| 控制器 UI/API/Webhook | `jenkins-tunnel-local-controller.service`，云端 `127.0.0.1:18082` | 转发到 WSL `127.0.0.1:18080` |
| GitHub SSH | `jenkins-tunnel-git.service`，本机网桥 `172.17.0.1:14443` | 经云服务器访问 `ssh.github.com:443`，控制器检出和轮询使用 |
| Harbor | `jenkins-tunnel-registry.service`，云端 `127.0.0.1:18081` | 云端 Docker 拉取镜像 |
| 部署 SSH | `jenkins-tunnel-deploy.service`，本机网桥 `172.17.0.1:10022` | Agent SSH 到云服务器 |
| Harbor 容器桥 | 云端 `jenkins-harbor-bridge.service` | 云端容器经 `172.17.0.1:18081` 访问 Harbor |

旧 WSL `jenkins-tunnel-controller.service` 曾将本机 `18080` 转到云端 Jenkins；迁移后不能继续启用这个旧定义，否则会与本机 Jenkins 的监听端口冲突。旧 WSL `jenkins-tunnel-docker.service` 不再供新控制器使用，新控制器直接调用本机 Docker socket。云端旧 `jenkins-websocket-bridge.service` 和 `jenkins-local-docker-api-bridge.service` 在验收后停用，原 unit 文件留作回退。

## 检查与恢复顺序

先确认 WSL 和 Docker，再检查本机控制器、反向隧道与云端代理；避免把本机停机误判成网站生产容器故障。

```powershell
wsl -d DockerEngine -- systemctl is-active docker harbor.service
wsl -d DockerEngine -- docker ps --format "{{.Names}} {{.Status}} {{.Ports}}"
wsl -d DockerEngine -- systemctl status jenkins-controller.service jenkins-tunnel-local-controller.service --no-pager
wsl -d DockerEngine -- curl --fail --silent --show-error http://127.0.0.1:18080/login -o /dev/null
wsl -d DockerEngine -- systemctl status jenkins-tunnel-registry.service jenkins-tunnel-deploy.service --no-pager
```

云端诊断按以下顺序进行；SSH 使用本机已批准的凭据，不将私钥内容、登录口令或 token 写入命令记录：

```bash
# 在云服务器执行，只读检查。
curl --fail --silent --show-error http://127.0.0.1:18082/login -o /dev/null
curl --fail --silent --show-error http://127.0.0.1:8080/login -o /dev/null
sudo nginx -t
systemctl is-active nginx
```

如果本机控制器服务停止，使用 `systemctl start jenkins-controller.service` 恢复；先读服务日志确认失败原因。如果 `18080` 正常而云端 `18082` 失败，检查并恢复 `jenkins-tunnel-local-controller.service`；如果 `18082` 正常而 `8080` 失败，检查云端 Nginx 配置与服务。隧道由持久服务维护，启用 SSH `ExitOnForwardFailure`、keepalive 和失败重启。保持 GitHub 使用原 Webhook 地址。

恢复完整发布能力还需要检查 Harbor 的 `18081` 反向隧道和部署 SSH 的 `10022` 本地转发。本机关机或 WSL 停止时，Jenkins 接收触发、管理、排队和新部署均不可用；已经运行在云服务器上的网站继续提供服务。

验收至少包含：

1. 新控制器能列出原任务、原构建记录，凭据 ID 保留；使用已有凭据完成实际 checkout、Harbor 登录和 SSH 部署。
2. 临时 Agent 在本机创建，并通过本机 WebSocket 地址连接成功。
3. 一次 GitHub 推送通过云端转发触发正确任务；控制器检出的 revision 与目标提交一致。
4. 任务实际构建并推送镜像，云端拉取目标标签，部署完成，线上容器镜像和公开页面检查通过。

## 凭据与备份

完整恢复需要 `JENKINS_HOME` 中的凭据 XML 与配套 `secrets/`、密钥文件一起保存。只复制任务 XML 或 `credentials.xml` 不能保证凭据可解密。

备份和迁移目录按私有运维数据保护，限制读取权限；不提交 Jenkins Home、`.env`、ops secret store、SSH 私钥、token、备份压缩包或完整控制台日志。仓库只记录非敏感路径、凭据 ID、端口和恢复流程。排查命令不要打印完整容器环境、凭据文件或 SSH 私钥。

## 回退到云端控制器

云端原 Jenkins 容器与原 `jenkins_home` 卷保留，停用其自动重启以防双控制器。回退需要先停止或静默本机控制器，避免两个实例执行同一任务。

先停止本机 `jenkins-controller.service` 和 `jenkins-tunnel-local-controller.service`，用本次迁移保存的云端回退脚本撤销 `8080` Nginx 代理、恢复原桥服务状态，再恢复旧云端容器的原重启策略并启动。重新启用旧 WSL `jenkins-tunnel-controller.service` 和 `jenkins-tunnel-docker.service`，让旧控制器能够创建本机 Agent；Harbor、部署 SSH 通道继续保留。最后检查旧控制器的任务状态与公开 Jenkins 地址，重新验证一次发布。

回退会回到云端旧 Home 的冻结时刻。迁移后在本机生成的新构建记录或配置不会自动合并回云端，回退前应另行保留本机 Home。任何时候都不要让两个控制器同时写入同一个 Home。
