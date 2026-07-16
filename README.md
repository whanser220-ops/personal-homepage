# 个人主页

这是 Huang 的个人主页项目。页面本身用于展示个人介绍、能力方向、项目作品和联系方式；仓库的迭代过程用于观察一个 Web 项目如何逐步扩展工程结构、交互脚本、前端框架和部署流程。

线上地址：

```text
http://1.117.232.198/
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
│   └── page.jsx
├── src/
│   ├── App.jsx
│   ├── styles.css
│   ├── components/
│   ├── data/
│   └── hooks/
├── public/
│   └── assets/
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

构建静态站点：

```powershell
npm run build
```

Next.js 配置了 `output: "export"`，构建结果会输出到 `out/`。

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
npm ci
npm run build
copy out/ to /var/www/personal-homepage
```

## Nginx 部署思路

服务器上的 Nginx 监听 80 端口。浏览器访问服务器 IP 时，请求先到达 Nginx，Nginx 根据站点配置里的 `root` 找到静态站点目录，再把 `index.html`、CSS、JS 和图片返回给浏览器。

服务器目录：

```text
/opt/personal-homepage
```

Git 工作副本，负责 `git pull`、安装依赖和构建。

```text
/var/www/personal-homepage
```

Nginx 静态站点根目录，只保存 `npm run build` 生成的 `out/` 内容。
