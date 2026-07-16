# 个人主页

这是一个从零开始学习全栈开发的静态网页案例。当前版本只使用 HTML、CSS 和 JavaScript，适合先理解浏览器、静态资源、GitHub 托管和 Nginx 部署流程。

## 项目结构

```text
.
├── index.html
├── styles.css
├── script.js
└── assets/
    └── hero-workspace.png
```

## 本地预览

直接用浏览器打开 `index.html` 即可。

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
    server_name _;
    root /var/www/personal-homepage;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```
