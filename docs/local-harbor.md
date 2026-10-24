# 本机 Harbor 镜像仓库

个人主页镜像仓库使用本机 WSL 发行版 `DockerEngine` 中的 Harbor，由该发行版里的 Linux Docker Engine 运行：

```text
UI/API:   http://127.0.0.1:18081
Registry: 127.0.0.1:18081
Project:  personal-homepage
Image:    127.0.0.1:18081/personal-homepage/personal-homepage:<tag>
```

Harbor 管理员账号和 Jenkins 凭据值不写入仓库，保存在本机 ops secret store 中。Jenkins 侧凭据 ID：

```text
harbor-personal-homepage
```

## Docker 访问边界

Jenkins 控制器、临时 Agent 和 Harbor 都运行在本机 WSL `DockerEngine` 的 Docker Engine 上。Agent 挂载宿主的 Docker socket，调用同一个 Docker Engine 构建和推送镜像；镜像地址里的 `127.0.0.1:18081` 由这个 Docker Engine 访问，指向本机 Harbor。

云服务器上的 Docker 和部署脚本运行在 `1.117.232.198`，它们看到的 `127.0.0.1` 是云服务器自己。云端拉取本机 Harbor 镜像，仍需要本机到云服务器的反向 SSH 隧道：

```text
云端 127.0.0.1:18081
  -> SSH 反向隧道
  -> WSL DockerEngine 的 127.0.0.1:18081
  -> Harbor
```

这条隧道由 WSL 的 `jenkins-tunnel-registry.service` 维护。隧道中断时，本机仍可构建和推送，但云服务器不能拉取镜像，部署会失败。

云服务器上保留 `jenkins-harbor-bridge.service`，供需要访问仓库的云端容器通过 Docker 网桥地址使用：

```text
172.17.0.1:18081 -> 127.0.0.1:18081
```

部署 SSH 连接也保留独立隧道，由 `jenkins-tunnel-deploy.service` 维护：

```text
本机 Agent -> WSL Docker 网桥 172.17.0.1:10022
  -> SSH 本地转发 -> 云服务器 127.0.0.1:22
```

Jenkins 控制器迁到本机后，云端 `8080` 只转发 UI、API 和 GitHub Webhook。完整链路与恢复方式见 [本机 Jenkins 控制器](jenkins-local-controller.md)。

在 PowerShell 中查看两条保留隧道的状态：

```powershell
wsl -d DockerEngine -- systemctl status jenkins-tunnel-registry.service jenkins-tunnel-deploy.service --no-pager
```

## 镜像发布流程

本机 Jenkins 调度临时 Agent；Agent 通过本机 Docker Engine 执行镜像构建和推送：

```text
docker build -t 127.0.0.1:18081/personal-homepage/personal-homepage:<commit> \
             -t 127.0.0.1:18081/personal-homepage/personal-homepage:latest .
docker push 127.0.0.1:18081/personal-homepage/personal-homepage:<commit>
docker push 127.0.0.1:18081/personal-homepage/personal-homepage:latest
```

部署服务器只拉取已发布镜像并启动：

```text
docker pull 127.0.0.1:18081/personal-homepage/personal-homepage:<commit>
docker compose up -d --no-build --force-recreate personal-homepage
```

Harbor 中的正式标签使用 `127.0.0.1:18081/personal-homepage/personal-homepage:*`。旧的 `deploy-from-git.sh` 只作为服务器本地手动兼容入口，Jenkins 正式部署入口是 `deploy/deploy-from-image.sh`。
