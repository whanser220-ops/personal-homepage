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
├── compose.yml
├── deploy/
│   ├── deploy-from-git.sh
│   └── nginx-personal-homepage.conf
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

当前技术栈、线上容器、Nginx 代理、PostgreSQL 数据流和 Jenkins 部署边界见：

```text
docs/current-architecture.md
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

Jenkins 从 GitHub `main` 分支读取 `Jenkinsfile`，然后通过 SSH 登录服务器并执行：

```bash
cd /opt/personal-homepage
BRANCH=main bash deploy/deploy-from-git.sh
```

部署脚本会执行：

```text
git fetch origin main
git checkout main
git pull --ff-only origin main
docker build -t whanser220/whanser:personal-homepage-<commit> -t whanser220/whanser:personal-homepage-latest .
docker push whanser220/whanser:personal-homepage-<commit>
docker push whanser220/whanser:personal-homepage-latest
docker compose up -d personal-homepage
nginx -t
reload nginx
health checks
```

`npm ci` 和 `npm run build` 在 Docker 镜像构建阶段执行。

Docker Hub 凭据不进入仓库。因为部署需要读取 root 权限的运行环境文件，服务器推荐通过 root Docker CLI 登录：

```bash
sudo docker login -u whanser220
```

也可以在服务器本地创建 root 可读的凭据文件：

```text
/etc/personal-homepage/dockerhub.env
```

内容格式：

```text
DOCKERHUB_USERNAME=whanser220
DOCKERHUB_TOKEN=<Docker Hub access token>
```

## Nginx 部署思路

服务器上的 Nginx 监听 80 端口。浏览器访问 `warmhanser.com` 或服务器 IP 时，请求先到达 Nginx，然后被反向代理到宿主机本地的 Next.js 容器端口：

```text
127.0.0.1:3000
```

服务器目录：

```text
/opt/personal-homepage
```

Git 工作副本，负责 `git pull` 和 Docker 镜像构建上下文。

```text
/etc/nginx/conf.d/personal-homepage.conf
```

Nginx 站点配置，负责把页面、静态资源和 `/api/*` 请求代理到 Next.js 应用容器。
