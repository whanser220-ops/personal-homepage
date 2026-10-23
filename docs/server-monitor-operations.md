# 服务监控运维

入口为 `https://warmhanser.com/server-monitor`，仅监控 `cloud-primary` 一台宿主机。本文说明配置、部署、回退与验收方式。

## 数据流与状态含义

`宿主机 Python/systemd 采集器 → 127.0.0.1:3000/api/monitor/ingest → Next.js → 现有 PostgreSQL → 授权后的浏览器看板`。

采集器每 15 秒采样，先写本机 SQLite，再按批投递；失败保留最多 1 小时，恢复后补传，以 `hostId + collectedAt` 去重。PostgreSQL 的 `monitor_samples` 保存 7 天，按小时清理；`monitor_sessions`、`monitor_oauth_transactions` 和 `monitor_housekeeping` 分别保存会话、短期登录事务和清理协调状态。网站容器不挂载 Docker socket。

指标来自宿主机 `/proc`、根文件系统和指定 Docker 容器。HTTP 检查、进程检查、TCP 可达分别展示；3xx/401/403 只说明 HTTP 端点可达，不能证明业务健康。所有检查均为服务器本机视角，不能独立证明公网可用性。首帧和计数回退的差分指标为 `null`，历史曲线保留缺口；最后采样超过 45 秒显示“数据已过期”。

## Google 登录与私有访问

复用 `/etc/study-agent/auth/google-oauth.json` 对应的现有 Google Web OAuth 应用。Google Console 中保留 Study Agent 的全部原有回调地址，只新增 `https://warmhanser.com/api/monitor/auth/google/callback`。部署器读取现有配置并生成网站专用环境文件，不改写 Study Agent 的 OAuth 文件。

`openid-client` 执行授权码流程，使用 state、S256 PKCE、nonce，并验证 Google ID Token。登录事务与浏览器的短期 Cookie 绑定、10 分钟过期、回调单次使用。仅接受 `email_verified === true` 且邮箱等于 `MONITOR_OWNER_EMAIL` 的身份，默认是 `whanser220@gmail.com`，以 Google `sub` 保存用户身份。

会话有效期 24 小时，数据库只存会话令牌的 SHA-256 摘要。Cookie `__Host-server-monitor-session` 设置 `Secure; HttpOnly; SameSite=Lax; Path=/`；退出使用同源 POST，删除数据库会话并清除会话及 OAuth Cookie。匿名、过期会话读取 current/history 返回 401，响应禁止缓存。公网 HTTP/HTTPS Nginx 均拒绝采集接口；采集器使用独立 Bearer 凭据从回环地址投递。

OAuth 出网经过 `personal-homepage-monitor-proxy.socket`：监听 `personal-homepage-net` 的 IPv4 gateway 上的 17891，转发到现有回环代理 `127.0.0.1:17890`。gateway 由安装器实时读取，不能写死为 `172.18.0.1`；监听地址不使用公网 IP 或 `0.0.0.0`。仅 OAuth 请求使用 `MONITOR_OAUTH_PROXY_URL`，未设置全局 HTTP 代理；请求目标限于代码中的 Google HTTPS 端点。

## 文件与凭据

| 路径 | 内容与权限 |
| --- | --- |
| `/etc/personal-homepage/app.env` | 现有网站环境，包含 `DATABASE_URL`；沿用原有权限，不能输出内容或放入 Git。 |
| `/etc/personal-homepage-monitor/web.env` | root:root、0600；父目录 0700。键名：`MONITOR_INGEST_TOKEN`、`MONITOR_GOOGLE_CLIENT_ID`、`MONITOR_GOOGLE_CLIENT_SECRET`、`MONITOR_OWNER_EMAIL`、`MONITOR_PUBLIC_URL`、`MONITOR_OAUTH_PROXY_URL`。 |
| `/etc/personal-homepage-monitor.env` | root:root、0600。键名：`MONITOR_INGEST_TOKEN`、`MONITOR_INGEST_URL`、`MONITOR_HOST_ID`、`MONITOR_INTERVAL_SECONDS`、`MONITOR_STATE_DIR`；可选 `MONITOR_NETWORK_INTERFACE`。采样周期由采集器固定为 15 秒。 |
| `/opt/personal-homepage-monitor/collector.py` | root 拥有、0644，不能允许采集器账号修改。 |
| `/var/lib/personal-homepage-monitor/` | `server-monitor` 拥有、0700；含 `queue.sqlite3` 和进程锁，SQLite 为 0600。 |
| `/var/lib/personal-homepage-monitor-deployment/` | 当前安装事务备份，0700；备份文件和 `metadata.json` 为 0600，成功 commit 后移除。 |

服务用户 `server-monitor` 通过 `docker` 补充组执行固定检查；Docker socket 仍具有宿主机管理能力，必须保护采集器程序、单元和环境文件。不要把完整环境、OAuth code、Cookie、令牌或 SQL 连接串写进诊断记录。

## 部署与失败恢复

优先使用现有 Jenkins `personal-homepage-deploy` 和 `deploy/deploy-from-image.sh`，让同一版本的镜像、采集器、部署清单一起发布，不要把下面的阶段当成未经核对的一键手工命令。

1. `install-server-monitor.py prepare` 备份文件与 systemd 状态，原子生成权限受限的环境文件并安装采集器及代理单元。已有未完成事务时拒绝覆盖；prepare 自身失败会恢复已有文件。
2. 部署脚本切换网站及白板镜像、检查健康；备份现有 HTTP 配置、`study-agent-https.conf` 和两个 snippet，安装监控路由并执行 `nginx -t` 后 reload。HTTPS 只插入专用 include，保留 Study Agent、白板原有配置。
3. `activate` 重新应用私网代理 socket 并启用、重启采集器。`verify-server-monitor.py` 检查匿名读 401、HTTP/HTTPS 公网 GET/POST 采集入口 404、登录已配置、页面可达，并有限重试等待新鲜样本；首次建表延迟或数据库短暂超时不会立即触发回退。
4. 自动检查通过后 `commit` 删除安装备份，再清理旧镜像。脚本捕获 prepare 后的失败，恢复安装文件、systemd 状态、Nginx 配置与先前运行镜像；Nginx 恢复不完整时保留备份路径供人工处理。脚本不会删除 SQLite 状态或 PostgreSQL 监控历史。

出现遗留事务时，先查看 Jenkins 失败阶段、服务状态和备份 metadata，确认备份属于哪次发布，再按同一版本安装器处理 rollback。不要直接删除备份目录来解除阻塞。只读诊断可用 `systemctl status personal-homepage-monitor.service personal-homepage-monitor-proxy.socket`、`journalctl -u personal-homepage-monitor.service --since '10 min ago'` 和 `nginx -t`；不要打印完整环境或原始 OAuth 响应。

已完成发布后的版本回退，应先记录当前站点和白板的镜像标签、目标提交以及服务状态，选定已知良好的前一站点镜像和匹配的部署代码，再通过该版本的部署流程执行。明确指定正确的 `APP_IMAGE`，并将 `WHITEBOARD_IMAGE` 固定为已确认的白板镜像，避免默认按站点旧标签意外回退白板。使用现有事务部署比单独替换容器更完整；成功 commit 后的安装备份已经移除，不能把 `rollback` 当作任意历史版本恢复功能。

若目标版本早于监控功能，先停止采集器，保留启停前状态，再按旧版本部署流程恢复站点；当前监控发布检查不适用于该旧镜像，不应强行绕过检查。只停采集器可以使用 `sudo systemctl stop personal-homepage-monitor.service`，不要删除状态目录、SQLite、数据库表或持久卷。恢复监控时发布匹配版本并重新启用采集器；仍在 1 小时窗口内的队列按正常规则补传。Nginx 变更继续通过原有备份、`nginx -t` 和 reload 流程完成，不覆盖整份 HTTPS 文件或移除 Study Agent、白板路由。

## 发布验收

- 核对 Jenkins 检出的目标提交、实际网站容器镜像标签与镜像 ID；页面 200 或 `/api/health` 的 `ok` 不能证明部署版本，该健康接口不返回提交 SHA。
- 使用真实 Google 账号完成正式域名登录，确认指定账号能访问；无权限账号、匿名、过期会话、伪造回调均不能读指标。退出后刷新仍为未登录；本地测试 Cookie 只能验证本地 UI，不能计作 Google 登录成功。
- 等待连续采样，与宿主机命令核对 CPU、内存、磁盘、网络及容器状态；检查 1h/24h/7d 范围、超过 45 秒的数据过期提示、缺口以及手机布局。首次没有七天历史是正常的，不能填充虚假曲线。
- 在受控窗口验证网站或数据库短暂不可用、采集器重启后的队列补传与去重，并检查清理周期；同时确认网站、白板、Study Agent、Jenkins 与已有构建指标仍正常。外部通知和整机失联告警不在当前版本范围内。
