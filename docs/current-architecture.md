# 个人网站当前技术栈与架构

最后核对时间：2026-08-31，Asia/Shanghai。

本文记录 `warmhanser.com` 当前线上运行形态。当前站点是 Next.js standalone 容器化动态站点，不是静态 `output: export` 站点。

## 技术栈

- 前端框架：Next.js App Router，React。
- 主要版本：`next 16.2.10`、`react 19.2.7`、`react-dom 19.2.7`。
- UI 与交互：Ant Design `5.29.3`、`@ant-design/nextjs-registry`、lucide-react、Anime.js、GSAP、自定义 CSS / CSS Modules。
- 服务端：Next.js Route Handlers，Node.js runtime。
- 数据访问：`pg 8.22.0` 连接 PostgreSQL。
- 运行镜像：多阶段 Docker build，基础镜像 `node:26-bookworm-slim`，发布到 Docker Hub `whanser220/whanser`。
- 数据库：PostgreSQL 16，线上容器镜像 `postgres:16-alpine`。
- 反向代理：宿主机 Nginx，监听 80 端口。
- CI/CD：GitHub `main` 分支，Jenkins Pipeline from SCM，Jenkins Docker Cloud 临时 agent。

## 应用结构

```text
app/
  layout.jsx                    全局 HTML、主题初始化、Ant Design SSR 注册
  page.jsx                      主页入口，渲染 LandingNavigation
  about/page.jsx                关于我
  articles/page.jsx             文章页
  projects/page.jsx             项目页
  build-monitor/page.jsx        Unity6 构建监控页
  api/health/route.js           健康检查
  api/build-metrics/*           构建监控写入、读取和 SSE 流

src/
  components/                   页面组件、导航、主题、构建监控面板
  data/homepage.js              主页展示数据
  hooks/useHomepageInteractions.js
  server/buildMetricsDb.js      PostgreSQL schema、读写和快照转换
  server/buildMetricsStream.js  进程内 EventEmitter，用于 SSE 快照广播

public/assets/                  页面图片和站点 logo
deploy/                         部署脚本、Nginx 配置、Jenkins agent 镜像
```

公开路由当前包括：

- `/`
- `/about`
- `/articles`
- `/projects`
- `/build-monitor`

## 构建监控数据流

`/build-monitor` 是当前站点的主要动态模块。它展示 Unity6 构建流程、阶段耗时、Bundle 进度、资源类型占用和冗余资源分析。

数据链路：

```text
Unity/Jenkins 构建过程
  -> POST /api/build-metrics/events
  -> Next.js Route Handler 校验 BUILD_METRICS_INGEST_TOKEN
  -> PostgreSQL build_metric_* 表
  -> 生成最新 snapshot
  -> 进程内 EventEmitter 发布 snapshot
  -> GET /api/build-metrics/stream 通过 SSE 推给浏览器
  -> 前端 BuildMonitorDashboard 实时更新
```

前端启动行为：

- `BuildMonitorDashboard` 首屏先显示 loading。
- 客户端 `useEffect` 成功执行后，等待 `BOOT_LOADING_MS = 900` 再显示 dashboard。
- 浏览器支持 `EventSource` 时使用 SSE。
- 不支持 SSE 时退回 30 秒轮询 `/api/build-metrics/runs/latest`。

PostgreSQL 表由应用在启动或首次访问时自动确保存在，主要表包括：

- `build_metric_runs`
- `build_metric_stages`
- `build_metric_bundles`
- `build_metric_asset_types`
- `build_metric_bundle_modules`
- `build_metric_redundant_assets`
- `build_metric_events`

## 线上运行架构

```text
浏览器
  -> http://warmhanser.com / http://1.117.232.198
  -> 宿主机 Nginx :80
  -> 127.0.0.1:3000
  -> Docker 容器 personal-homepage
  -> Docker 网络 personal-homepage-net
  -> Docker 容器 personal-homepage-postgres
  -> Docker 卷 personal_homepage_pgdata
```

当前线上核对结果：

- 云主机：`1.117.232.198`，hostname `VM-0-12-ubuntu`。
- 线上源码目录：`/opt/personal-homepage`。
- 线上分支：`main`。
- 线上提交：跟随 Jenkins 最后一次成功部署的 `main` 提交。
- 应用容器：`personal-homepage`。
- 应用镜像：`whanser220/whanser:personal-homepage-<commit>`。
- 应用端口：容器 `3000/tcp` 映射到宿主机 `127.0.0.1:3000`。
- 应用重启策略：`unless-stopped`。
- 数据库容器：`personal-homepage-postgres`。
- 数据库镜像：`postgres:16-alpine`。
- 数据库卷：`personal_homepage_pgdata:/var/lib/postgresql/data`。
- Docker 网络：`personal-homepage-net`。
- 运行环境文件：`/etc/personal-homepage/app.env`。
- Nginx 配置：`/etc/nginx/conf.d/personal-homepage.conf`。

## Nginx 代理

Nginx 的 upstream 指向本机回环地址：

```text
personal_homepage_app -> 127.0.0.1:3000
```

站点配置监听：

```text
server_name warmhanser.com www.warmhanser.com 1.117.232.198;
```

Nginx 代理规则：

- `/` 代理到 Next.js 应用。
- `/_next/static/` 代理到 Next.js 应用，缓存 1 年，`immutable`。
- `/assets/` 代理到 Next.js 应用，缓存 30 天。
- `/api/health` 代理到 Next.js 应用，并禁用缓存。
- `/api/build-metrics/runs/latest` 代理到 Next.js 应用，并禁用缓存。
- `/api/build-metrics/events` 代理到 Next.js 应用，限制请求体 `128k`。
- `/api/build-metrics/stream` 代理到 Next.js 应用，关闭缓冲，`proxy_read_timeout 1h`，用于 SSE。

## 部署流程

Jenkins 任务：

```text
personal-homepage-deploy
```

Jenkins 任务类型是 Pipeline from SCM：

```text
repo: git@github.com:whanser220-ops/personal-homepage.git
branch: */main
scriptPath: Jenkinsfile
```

流水线执行节点：

```text
label: personal-homepage-docker-agent
image: personal-homepage-jenkins-agent:latest
remoteFs: /home/jenkins/agent
docker api: unix:///var/run/docker.sock
```

部署边界：

- Jenkins 控制器运行在 `jenkins/jenkins:lts` 容器内。
- Jenkins Docker Cloud 通过宿主机 Docker API 拉起临时 agent。
- Pipeline 在 agent 内执行，但真正的站点部署目录属于宿主机。
- Pipeline 使用 Jenkins 凭据 `bundle-report-ssh-key` SSH 到宿主机网关 `172.17.0.1`。
- 宿主机执行 `/opt/personal-homepage/deploy/deploy-from-git.sh`。

部署脚本做的事情：

```text
git fetch origin main
git checkout main
git pull --ff-only origin main
检查 /etc/personal-homepage/app.env
确保 PostgreSQL 容器存在且可用
docker build -t whanser220/whanser:personal-homepage-<commit> -t whanser220/whanser:personal-homepage-latest .
docker push whanser220/whanser:personal-homepage-<commit>
docker push whanser220/whanser:personal-homepage-latest
docker compose up -d personal-homepage
检查 /api/health
安装 Nginx 配置
nginx -t
systemctl reload nginx
检查 /api/build-metrics/runs/latest
```

如果新应用容器健康检查失败，脚本会尝试回滚到之前的镜像。

## 当前验证结果

2026-08-30 核对时，以下公开入口均返回 HTTP 200：

- `http://warmhanser.com/`
- `http://warmhanser.com/about`
- `http://warmhanser.com/articles`
- `http://warmhanser.com/projects`
- `http://warmhanser.com/build-monitor`

接口状态：

- `GET /api/health` 返回 `ok: true`。
- `GET /api/build-metrics/runs/latest` 返回 `configured: true`、`source: postgres`。
- 最新构建监控数据源是 `unity-linux-docker-build`，最近核对到的构建号为 `120`。

