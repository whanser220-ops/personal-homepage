# 个人主页

这是 Huang 的个人主页项目。页面本身用于展示个人介绍、能力方向、项目作品和联系方式；仓库的迭代过程用于观察一个 Web 项目如何逐步扩展工程结构、交互脚本、前端框架和部署流程。

线上地址：

```text
http://warmhanser.com/
```

服务器 IP：

```text
1.117.232.198
```

GitHub 仓库：

```text
https://github.com/whanser220-ops/personal-homepage
```

## 项目结构

```text
.
├── app/
│   ├── layout.jsx
│   ├── page.jsx
│   └── api/
├── src/
│   ├── App.jsx
│   ├── styles.css
│   ├── components/
│   ├── data/
│   ├── hooks/
│   └── server/
├── docs/
│   └── current-architecture.md
├── public/
│   └── assets/
├── deploy/
│   ├── deploy-from-git.sh       手动兼容入口：在服务器本地从 Git 构建
│   ├── deploy-from-image.sh     Jenkins 正式入口：只拉取 Harbor 镜像并用 compose 启动
│   ├── jenkins-agent/
│   └── nginx-personal-homepage.conf
├── compose.yml
├── Jenkinsfile
├── next.config.mjs
├── package.json
└── package-lock.json
```

## 本地开发

安装依赖：

```powershell
npm install
```

启动开发服务器：

```powershell
npm run dev
```

构建生产产物：

```powershell
npm run build
```

Next.js 当前配置为 `output: "standalone"`，生产运行入口是 `.next/standalone/server.js`。线上通过 Docker 镜像运行，不再使用 `out/` 静态导出目录。

## 当前架构文档

当前技术栈、线上容器、Nginx 代理、PostgreSQL 数据流、Harbor 镜像仓库和 Jenkins 部署边界见：

```text
docs/current-architecture.md
```

本机 Harbor 镜像仓库说明见：

```text
docs/local-harbor.md
```

## 当前前端实现

- 使用 Next.js App Router 管理页面入口和 metadata。
- 使用 React 组织页面组件。
- 使用 Anime.js 维护入场动画、滚动出现动画、卡片 hover、按钮点击反馈和数字动画。
- 使用 `src/data/homepage.js` 管理页面展示数据。
- 使用 `src/hooks/useHomepageInteractions.js` 集中管理页面交互和动画生命周期。

## 标准开发流程

本项目按分支和 PR 流程推进：

```powershell
git switch -c codex/feature-name
npm install
npm run build
git add -A
git commit -m "Describe the change"
git push -u origin codex/feature-name
```

然后在 GitHub 创建 Pull Request，检查无误后合并到 `main`。

## Jenkins 自动部署

Jenkins 任务：

```text
personal-homepage-deploy
```

Jenkins 从 GitHub `main` 分支读取 `Jenkinsfile`。流水线在 `personal-homepage-docker-agent` 临时容器里完成镜像构建和推送，然后通过 SSH 登录部署服务器，只让服务器从 Harbor 拉取镜像并用 Docker Compose 启动。

流水线主要步骤：

```text
checkout main
docker build -t 127.0.0.1:18081/personal-homepage/personal-homepage:<commit> .
docker push 127.0.0.1:18081/personal-homepage/personal-homepage:<commit>
docker push 127.0.0.1:18081/personal-homepage/personal-homepage:latest
scp compose.yml deploy/deploy-from-image.sh deploy/nginx-personal-homepage.conf /opt/personal-homepage/
APP_IMAGE=127.0.0.1:18081/personal-homepage/personal-homepage:<commit> bash deploy/deploy-from-image.sh
docker pull 127.0.0.1:18081/personal-homepage/personal-homepage:<commit>
docker compose up -d --no-build --force-recreate personal-homepage
nginx -t
reload nginx
health checks
```

`npm ci` 和 `npm run build` 在 Jenkins agent 容器触发的 Docker 镜像构建阶段执行。部署服务器不再 `git pull`，也不再 `docker build` 应用镜像。

## Nginx 部署思路

服务器上的 Nginx 监听 80 端口。浏览器访问 `warmhanser.com` 或服务器 IP 时，请求先到达 Nginx，然后被反向代理到宿主机本地的 Next.js 容器端口：

```text
127.0.0.1:3000
```

服务器目录：

```text
/opt/personal-homepage
```

部署工作目录，保存 `compose.yml`、部署脚本和 Nginx 配置；应用代码由镜像承载。

```text
/etc/nginx/conf.d/personal-homepage.conf
```

Nginx 站点配置，负责把页面、静态资源和 `/api/*` 请求代理到 Next.js 应用容器。
