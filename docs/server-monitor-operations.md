# 服务监控运维

入口为 `https://warmhanser.com/server-monitor`，仅监控 `cloud-primary`。网站自有 React/SVG 页面直接读取 Next.js 授权 API，不加载 Grafana iframe。保留 Google 登录、导航、主题及移动布局，不发送外部通知。图表显示真实缺失和历史断点，不填零或延续旧值。

## 组件和数据责任

浏览器 → Next.js Google 数据库会话 → 固定 Prometheus 查询 → Docker 私网 relay → 同机独立 Prometheus。资源旧历史在首次切换边界前继续从 PostgreSQL 读取；OAuth 会话与应用数据仍由 PostgreSQL 管理。浏览器不能访问数据库、Docker socket、Prometheus 或 exporter。

| 组件 | 回环端口 | 抓取频率 | 数据 |
| --- | --- | --- | --- |
| Prometheus 3.13.5 | 19090 | — | 独立 TSDB，保留 7 天、1 GB 上限；空间先耗尽可能提前删除旧块 |
| node_exporter 1.12.1 | 19101 | 3 秒 | CPU、负载、内存、Swap、根盘、默认出口网卡、运行时间及可选 PSI |
| cAdvisor 0.60.6 | 19102 | 15 秒 | 固定 3 个容器的 CPU 累计计数、working set、内存上限、last_seen |
| blackbox_exporter 0.29.1 | 19103 | 15 秒 | 固定 4 个 HTTP 和 2 个 TCP 检查 |
| Python custom | 19104 | 15 秒 | 受限 Docker 元数据、4 项 systemd 状态及 PostgreSQL 就绪检查 |
| nginxlog exporter 1.11.0 | 19111 | 3 秒 | 实际 Nginx 请求计数、耗时直方图、响应字节及解析错误 |

`personal-homepage-prometheus-proxy.socket` 只在当前 `personal-homepage-net` IPv4 gateway 的 19091 转发至 127.0.0.1:19090。网站容器保持原权限，不挂载 Docker socket。影子 Prometheus 使用 127.0.0.1:19094、Docker gateway:19095 和独立 TSDB，仅用于切换前验证；成功后停止两者。127.0.0.1:19092 属于其他服务，不能占用或停止。

官方发行物由 root 预先放到 `/opt/personal-homepage-prometheus/downloads`。安装器固定版本、SHA-256、普通归档成员/ELF 校验；只安装已知文件，不从任意 URL 获取程序。版本与完整校验值以 `install-prometheus.py`、`install-monitor-exporters.py`、`install-http-metrics.py` 为准。来源：[Prometheus](https://github.com/prometheus/prometheus/releases/tag/v3.13.5)、[node_exporter](https://github.com/prometheus/node_exporter/releases/tag/v1.12.1)、[cAdvisor](https://github.com/google/cadvisor/releases/tag/v0.60.6)、[blackbox_exporter](https://github.com/prometheus/blackbox_exporter/releases/tag/v0.29.1)、[nginxlog exporter](https://github.com/martin-helmich/prometheus-nginxlog-exporter/releases/tag/v1.11.0)。

Prometheus 使用独立用户、MemoryHigh 256M、MemoryMax 512M、CPUQuota 80%（最多 0.8 核）。node/cAdvisor/blackbox/custom 的内存上限分别为 96/192/96/128 MB，HTTP exporter 为 96 MB；这是保护上限，实际消耗应看 cgroup，而不是相加。cAdvisor 原生 root 和 custom 的 Docker 组有宿主机高权限；保护其 root 拥有的程序/unit，网站不获得这些权限。

## 查询、真实性与登录

页面当前值每 3 秒查询；历史降低到 30 秒，三档点间隔为 3 秒、5 分钟、30 分钟。资源与服务来源仍保持 3 秒/15 秒采样。来源未就绪、抓取失败、计数回退或容器重建保留未知；资源超过 45 秒没有采样标为过期。

- `/api/monitor/current`：主机、容器及 11 项服务；HTTP 2xx 健康、3xx/401/403 入口可达、TCP 仅端口可达、systemd 仅进程运行。结果为服务器本机视角。
- `/api/monitor/history?range=1h|24h|7d`：资源历史 1201/289/337 点，原 PG 历史与 Prometheus 按首次切换边界拼接。
- `/api/monitor/signals/current?service=all|website|whiteboard|study-agent`：真实流量、成功/失败 P95/P99、5xx/4xx 比例、响应字节；HTTP 来源和同一规则帧均须在 9 秒内新鲜。
- `/api/monitor/signals/history?service=...&range=...`：上述 8 项信号历史，点数相同。HTTP 指标安装前没有请求历史；无请求时延迟/比例可以为空，不用零表示健康。`no_data` 与真实已观察零速率 `no_traffic` 分开。

HTTP 记录规则最后生成 `server_monitor_http_recorded_at_seconds`。API 按相同原始记录帧关联，再检查实际 exporter 采样时间和规则时间；不能通过 Prometheus lookback 把消失的旧 500/旧桶重新拼回。跨服务延迟先合并直方图桶再求分位数，不能平均服务分位数。窗口速率是采样估计，不是精确请求账本。完整覆盖限制见 [HTTP_METRICS.md](../services/server-monitor/HTTP_METRICS.md)。

Google 复用 Study Agent OAuth 应用，回调 `https://warmhanser.com/api/monitor/auth/google/callback`。`openid-client` 校验 state、PKCE、nonce、Google 身份、已验证邮箱，唯一 owner 为 `whanser220@gmail.com`，以 `sub` 标识身份。会话在 PostgreSQL，默认 24 小时；Cookie 为 Secure、HttpOnly、SameSite=Lax，退出立即删除会话。所有读取接口先鉴权、禁止缓存；无/伪造/过期会话 401，合法会话非法枚举 400，来源失败 503。匿名 Google 登录流程和原 Study Agent 回调保持。

`/etc/personal-homepage-monitor/web.env` 为 root:root 0600、父目录 0700。保留 OAuth、owner、public URL、旧 ingest token；生产设置 `MONITOR_DATA_BACKEND=prometheus`、`MONITOR_EXPORTER_MODE=standard`、私网 `MONITOR_PROMETHEUS_URL`，并保持原 `MONITOR_PROMETHEUS_CUTOVER_AT`（当前首次边界 `2026-10-25T03:49:21.701Z`），后续发布不能重置。边界前旧 `monitor_samples` 与边界后原 TSDB 按样本数量合并，不拼接影子 TSDB。Google 出网仍使用原独立 OAuth socket 17891，不覆盖其他代理。

## 独立隐私日志与轮转

`nginx-monitor-http.conf` 只记录 service/status/request_time/body_bytes_sent 四字段，固定 website/whiteboard/study-agent。没有 URL、IP、查询、请求头、Cookie、用户代理或正文。监控页面/API、健康检查、WebSocket、SSE 排除。仅 Nginx 完成的请求有计数与耗时；绕开 Nginx 的访问不在覆盖内。

`install-monitor-logrotate.py` 独立管理 `/var/log/personal-homepage-monitor`（root:www-data 0750）、`traffic.jsonl`（root:www-data 0640），以 append/no-follow 保留现有 inode 和内容。策略是 `/etc/personal-homepage-monitor/traffic.logrotate`，timer 每小时检查、10 MB 上限触发、copytruncate、保留 2 份；状态仍为 `/var/lib/personal-homepage-monitor-logrotate/status`。不使用 `su` 或 SETUID/SETGID 能力。HTTP exporter 只能读，启动从 EOF 读取，重启/中断期间的请求不会补放。

安装先运行真正受限 systemd fixture 的 3 次隔离轮转，再正常（非 force）运行生产 oneshot，确认 `Result=success`、`ExecMainStatus=0` 及 timer enabled/active。不能仅看 timer 或 logrotate --debug。回退只恢复 policy/unit/启停状态，不回卷、删除日志、归档或状态，不依赖任何 Grafana 路径。

## Jenkins 发布与事务回退

始终在任务 worktree 完成验证，提交后由现有 `personal-homepage-deploy` 发布，核对目标提交和线上版本。Jenkins 传递同版本镜像、部署清单、规则和 API 语义夹具；未变化的 exporter/Prom 配置不应因普通网站发布重启。

1. 原监控/OAuth prepare。运行只针对新唯一名称 PG 容器（network none、无端口）和临时 systemd unit 的 retirement fixture，验证 NOLOGIN/恢复 LOGIN、服务停启和样本/会话哨兵不变。`retire-grafana.py prepare` 仅快照旧 service 与固定专用角色属性，不停止服务或改库。
2. 独立轮转 prepare → HTTP exporter prepare → exporter/影子 Prom prepare。固定 promtool 验证 node/HTTP 规则和由目标 Node 镜像根据实际 API 查询生成的 9 场景夹具。发现真实根盘/sysfs 与出口网卡，不依赖错误分区默认过滤；node 允许 netdev 的 AF_NETLINK。
3. `verify-monitor-runtime.py --image <目标> --network personal-homepage-net --exporter-mode standard --prometheus-port 19095` 运行真实编译 Next server，容器内回环监听、无发布端口/生产密钥。内存固定伪会话替代数据库，不创建真实会话或写库。验证自有页面无 iframe、旧 Grafana 授权路由 404、资源数据/3 容器/11 服务、信号 API 的四服务与三档历史、匿名/伪会话/非法参数和缺失值。
4. 候选通过才 prepare/cutover 生产 Prom，保留原 TSDB 和切换边界；更新网站/白板镜像，原子更新 HTTP/HTTPS snippet 与 privacy map，nginx -t 成功才 reload。保留现有 HTTP/2、Study Agent/白板路由。
5. `verify-server-monitor.py` 验证自有页面、Google 配置、匿名资源/信号 401、公网 ingest 404、旧 Grafana/授权/internal 路径双协议不重定向且 404、私网监听与真实网站容器读取；再验证正常轮转。真实 Google、桌面/手机布局另行验收，编译伪会话不能替代真实登录证明。
6. 所有验证成功后才 finalize：旧推送/统一 Python 与影子栈保持停用；`retire-grafana.py finalize` 停止并禁用固定旧 Grafana service，确认已停后将 `monitor_grafana_history` 设为 NOLOGIN，确认无 19110 监听。只接受具有原事务标签、无高权限、连接上限 2 的专用角色。保留旧受限视图、history.env、SQLite、程序、配置、二进制；不 DROP、不清理历史或会话。随后提交各事务。

失败先恢复原 Nginx；回退 Prom/HTTP；退役事务先恢复固定角色原 LOGIN 位，再按快照恢复旧 Grafana unit；独立轮转恢复旧 unit/path，旧策略文件一直保留。之后回退 exporter/OAuth 并重建匹配旧网站/白板镜像。所有事务目录为 0700、快照 0600；新增目录为 `/var/lib/personal-homepage-grafana-retirement` 和 `/var/lib/personal-homepage-logrotate-deployment`。未结束事务拒绝覆盖，应查失败构建并用匹配源码 rollback，不能直接删除快照解除阻塞。

成功 commit 后要回到旧版本，需用历史 Git 版本的完整镜像和匹配部署代码恢复旧代理配置/登录角色/服务；不能用当前已提交事务 rollback 代替版本回退。保留的 Grafana DB、受限历史 view/env 和二进制只服务这一可逆回退，不运行对外仪表盘。

## 只读诊断与验收

```sh
systemctl status personal-homepage-prometheus.service personal-homepage-node-exporter.service personal-homepage-cadvisor.service personal-homepage-blackbox-exporter.service personal-homepage-monitor-custom.service personal-homepage-http-metrics.service
systemctl show personal-homepage-monitor-logrotate.service -p Result -p ExecMainStatus
systemctl is-active personal-homepage-monitor-logrotate.timer
curl --fail --silent http://127.0.0.1:19090/-/ready
ss -lnt
```

不能输出完整环境、OAuth 响应、Cookie、SQL 密码、连接串或任意标签/日志全集。指标不读取容器环境、密钥和完整健康日志，不能增加动态 URL/请求 ID 等高基数标签。public Grafana 路径及旧授权路由固定 no-store 404；19110、19100、19094/19095 停止，19090、19101–4、19111 仅回环，19091 仅 Docker gateway。

分别核对离线语义、实际编译运行时、Jenkins 精确提交、生产镜像、真实 Google 登录和浏览器视觉/移动布局。对照宿主机固定命令、Docker 固定字段及累计计数；确认 3 秒/15 秒节拍、三档历史、原 PG 边界和已有 TSDB、请求来源覆盖与 null 断点、11 项服务语义及既有网站/白板/Study Agent/Jenkins/Perforce 正常。新组件/来源中断的故障测试应在影子栈做，不能为验收随意中断生产。

网站/数据库故障不会中断其余指标采集，但看板与登录仍可能不可用。Prometheus 停止期间没有采样，无法靠 SQLite 补回。整台服务器失联时同机组件一起停止，不能当外部可用性告警。7 天 retention 配置可即时检查，短期测试不能证明完整 7 天稳定性和到期行为。
