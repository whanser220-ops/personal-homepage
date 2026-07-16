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
├── styles.css
├── script.js
├── assets/
│   └── hero-workspace.png
└── deploy/
    └── nginx-personal-homepage.conf
```

## 本地预览

推荐通过本地 HTTP 服务预览，这样 Module CDN 脚本和静态资源的加载方式更接近线上环境。

如果想通过本地 HTTP 服务预览，可以运行：

```powershell
python -m http.server 8080
```

然后访问：

```text
http://localhost:8080
```

## Nginx 部署思路

服务器上的 Nginx 监听 80 端口。浏览器访问服务器 IP 时，请求先到达 Nginx，Nginx 根据站点配置里的 `root` 找到网页目录，再把 `index.html`、CSS、JS 和图片返回给浏览器。

本项目部署目录：

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
- 使用 Module CDN 在 `script.js` 中导入 `animate` 和 `stagger`。
- 使用 IntersectionObserver 维护当前导航高亮和滚动触发动画。
- 使用 DOM 事件更新“亮点”区的进度条、计数器和主页状态。
