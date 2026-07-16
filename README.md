# 个人主页

这是 Huang 的个人主页项目。页面本身用于展示个人介绍、能力方向、项目作品和联系方式；仓库的迭代过程用于观察一个 Web 项目如何逐步扩展工程结构、交互脚本和部署流程。

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
├── index.html
├── package.json
├── src/
│   ├── main.js
│   ├── styles.css
│   └── modules/
│       ├── anime.js
│       ├── buttons.js
│       ├── cards.js
│       ├── hero.js
│       ├── highlights.js
│       ├── nav.js
│       ├── reveal.js
│       └── score.js
├── public/
│   └── assets/
│       └── hero-workspace.png
└── deploy/
    └── nginx-personal-homepage.conf
```

## 本地预览

推荐通过 Vite 开发服务器预览，这样模块导入、依赖解析和静态资源路径都更接近现代前端项目。

安装依赖：

```powershell
npm install
```

启动开发服务器：

```powershell
npm run dev
```

然后访问：

```text
http://localhost:5173
```

构建生产版本：

```powershell
npm run build
```

## Nginx 部署思路

服务器上的 Nginx 监听 80 端口。浏览器访问服务器 IP 时，请求先到达 Nginx，Nginx 根据站点配置里的 `root` 找到网页目录，再把 `index.html`、CSS、JS 和图片返回给浏览器。

本项目在服务器上使用两个目录：

```text
/opt/personal-homepage
```

Git 工作副本，负责 `git pull`、安装依赖和构建。

```text
/var/www/personal-homepage
```

Nginx 静态站点根目录，只保存 `npm run build` 生成的 `dist/` 内容。

## 标准开发流程

本项目后续按分支和 PR 流程推进：

```powershell
git switch -c codex/feature-name
npm install
npm run dev
npm run build
git add -A
git commit -m "Describe the change"
git push -u origin codex/feature-name
```

然后在 GitHub 创建 Pull Request，检查无误后合并到 `main`。

## 服务器拉代码部署

首次在服务器准备 Git 工作副本：

```bash
sudo install -d -m 0755 -o ubuntu -g ubuntu /opt/personal-homepage
git clone https://github.com/whanser220-ops/personal-homepage.git /opt/personal-homepage
cd /opt/personal-homepage
```

每次 PR 合并后，在服务器执行：

```bash
cd /opt/personal-homepage
bash deploy/deploy-from-git.sh
```

脚本会执行：

```text
git fetch origin main
git checkout main
git pull --ff-only origin main
npm ci
npm run build
copy dist/ to /var/www/personal-homepage
```

Nginx 站点目录：

```text
/var/www/personal-homepage
```

对应的 Nginx 配置核心逻辑：

```nginx
server {
    listen 80;
    server_name 1.117.232.198;
    root /var/www/personal-homepage;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

## 当前 JavaScript 实现点

- 使用 Anime.js 做首页入场动画、滚动出现动画、卡片 hover 动效和按钮点击涟漪。
- 使用 Vite 管理开发服务器、模块解析和生产构建。
- 使用 npm 依赖在 `src/modules/anime.js` 和 `src/modules/score.js` 中导入 Anime.js 能力。
- 使用 `src/main.js` 作为入口文件，按导航、卡片、亮点、按钮等功能拆分模块。
- 使用 IntersectionObserver 维护当前导航高亮和滚动触发动画。
- 使用 DOM 事件更新“亮点”区的进度条、计数器和主页状态。
