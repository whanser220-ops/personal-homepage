# 本机 Harbor 镜像仓库

个人主页镜像仓库使用本机 Docker Desktop 上的 Harbor：

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

本机 Harbor 部署在 Windows 的 Docker Desktop 上。对本机 Docker 来说，`127.0.0.1:18081` 就是 Harbor。

云服务器上的 Jenkins 和部署脚本运行在 `1.117.232.198`，它们看到的 `127.0.0.1` 是云服务器自己，不是 Windows 本机。如果要让云端 Jenkins 自动 push/pull 本机 Harbor，需要保持一个从本机到云服务器的反向 SSH 隧道：

```powershell
ssh -N -T -i "C:\Users\huang\Documents\云服务器\.ssh\agent.pem" `
  -o IdentitiesOnly=yes `
  -o ExitOnForwardFailure=yes `
  -R 127.0.0.1:18081:127.0.0.1:18081 `
  ubuntu@1.117.232.198
```

有这条隧道时，云服务器上的 `127.0.0.1:18081` 会转发到本机 Harbor。没有这条隧道时，云端 Jenkins 的 registry login/push/pull 会失败。

Jenkins 控制器运行在云服务器的 Docker 容器里，容器内的 `127.0.0.1` 是 Jenkins 容器本身。为了让控制器也能检查 Harbor，云服务器上需要保留一个桥接转发：

```text
172.17.0.1:18081 -> 127.0.0.1:18081
```

本机维护脚本：

```text
C:\Users\huang\harbor-local\start-harbor-tunnel.ps1
```

## 镜像发布流程

Jenkins agent 容器执行镜像构建和推送：

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
