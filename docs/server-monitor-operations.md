# 服务监控运维

入口为 `https://warmhanser.com/server-monitor`，仅监控 `cloud-primary` 一台宿主机。Google 登录和玻璃看板沿用现有网站，指标采集与历史存储由同机独立运行的 Prometheus 负责。未部署 Grafana，不发送外部通知。

## 数据流与采样

`Prometheus → 回环 Python exporter → 宿主机 /proc、固定 Docker 字段与服务探测`；查询链路为 `浏览器 → Google 会话校验后的 Next.js → Docker 私网 relay → Prometheus HTTP API`。

Prometheus 控制采样节拍：`server-monitor-host` 每 3 秒抓取 `/metrics/host`，超时 2 秒；`server-monitor-checks` 每 15 秒抓取 `/metrics/checks`，超时 12 秒。exporter 复用现有 `collector.py` 的固定只读采样函数，按抓取请求采样，不运行其主循环、SQLite、Bearer 投递或环境文件读取。主机与慢检查使用独立锁；慢检查沿用固定四 worker 池、命令和探测超时，同类采样不重叠。缺失值不导出，不能用 0 替代。采集器重启后的差分首帧保留缺口。

页面当前值每 3 秒请求，历史每 30 秒请求，切换范围立即加载；1 小时按 3 秒、24 小时按 5 分钟、7 天按 30 分钟聚合。后端检查指标自身的 `server_monitor_host_collected_at_seconds` 和 `server_monitor_checks_collected_at_seconds`，分别超过 45 秒时标记过期；抓取成功不等于采样时间新鲜。

Prometheus 使用独立本机时序数据库，保留 7 天，并设置 1 GB 保留大小上限：达到任一限制后删除较旧 block，故大小上限可能缩短实际历史。大小保留不是整个目录的硬配额，WAL/head 等仍需要额外磁盘余量。不要把运行中的 TSDB 目录作为普通文件直接复制；当前没有远端长期存储或独立服务器告警。

## 指标、服务与故障语义

CPU 来自 `/proc/stat` 差分，负载、内存、Swap、网络来自 `/proc`，根盘容量来自 `statvfs('/')`，吞吐量只对根设备计数，避免重复累加。网络只取默认出口，避免重复计算 Docker/veth。Docker 仅读取网站、白板和 PostgreSQL 三个固定生产容器；旧云端 Jenkins 容器不作为当前容器，Jenkins 健康经现有回环转发探测本机 WSL 控制器。

HTTP 检查、进程检查与 TCP 可达明确区分。HTTP 不跟随重定向，不读取响应体；3xx/401/403 仅说明端点可达。Study Agent 的认证跳转不直接判故障。systemd 查询固定服务状态；PostgreSQL 使用固定 `pg_isready`；Perforce 与远程运行 TCP 只证明端口可达。全部探测注明服务器本机视角。

网站或 PostgreSQL 暂停时，Prometheus 继续抓取并保存指标，网站查询和登录会暂时不可用；恢复后直接查询保留的数据，不再依赖 SQLite 补传。Prometheus 或 exporter 停止时，相应历史出现真实缺口。整台服务器失联时，同机监控也停止，不能把本机探测当作外部可用性保证。

## 独立部署与访问边界

| 组件 | 安装与访问 |
| --- | --- |
| Prometheus | 官方 Linux amd64 `3.13.5`，二进制位于 `/opt/personal-homepage-prometheus/releases/3.13.5/`；`personal-homepage-prometheus.service` 使用独立 `prometheus-monitor` 用户，无 Docker 权限。 |
| 配置与 TSDB | `/etc/personal-homepage-prometheus/prometheus.yml`，root 拥有、0644；`/var/lib/personal-homepage-prometheus/`，服务用户拥有、0700。 |
| Prometheus HTTP | 只监听 `127.0.0.1:19090`，不启用 admin API 或生命周期写入 API。 |
| exporter | `/opt/personal-homepage-monitor/exporter.py` 与 `collector.py`，root 拥有、0644；`personal-homepage-monitor-exporter.service` 使用 `server-monitor`，只监听 `127.0.0.1:19100`，仅允许回环网络访问。 |
| 网站查询 relay | `personal-homepage-prometheus-proxy.socket` 仅监听当前 `personal-homepage-net` IPv4 gateway 的 `19091`，由 `systemd-socket-proxyd` 转发到回环 `19090`。不使用公网 IP 或 `0.0.0.0`；仅信任网站所在 Docker 网络。 |
| 网站容器 | 不挂载 Docker socket、不增加宿主机权限；通过 `MONITOR_PROMETHEUS_URL=http://<gateway>:19091` 查询固定指标。Prometheus UI 不增加公网路由。 |

Prometheus 设置 `GOMEMLIMIT=256MiB`、`MemoryHigh=256M`、`MemoryMax=512M`、`CPUQuota=80%`，即最多使用 0.8 个 CPU 核心，在当前双核主机上相当于整机 CPU 的 40%；exporter 沿用 `MemoryMax=128M`、`CPUQuota=20%`。这些是保护上限，不代表实际资源开销；需查看 cgroup 与 RSS 实测，OOM 时会留下缺口。`server-monitor` 的 Docker 补充组仍有宿主机管理能力，必须保护脚本与 unit 写权限，不授予网站该权限，不向 exporter 提供 OAuth 或数据库密钥。

## Google 登录与旧数据

复用 `/etc/study-agent/auth/google-oauth.json`，保留 Study Agent 原有回调，网站回调为 `https://warmhanser.com/api/monitor/auth/google/callback`。沿用 `openid-client` 的 state、PKCE、nonce、Google ID Token 与 `email_verified` 校验；仅允许 `whanser220@gmail.com`，用 Google `sub` 标识用户。会话仍在 PostgreSQL，默认 24 小时，Cookie 为 Secure、HttpOnly、SameSite=Lax；退出立即删除会话，所有读取接口禁止缓存。

`/etc/personal-homepage-monitor/web.env` 为 root:root、0600，父目录 0700。保留原 OAuth、owner、public URL、ingest token，并增加：

- `MONITOR_DATA_BACKEND=prometheus`：选用独立时序存储。
- `MONITOR_PROMETHEUS_URL=http://<gateway>:19091`：只允许固定私网数值地址与端口。
- `MONITOR_PROMETHEUS_CUTOVER_AT=<UTC ISO timestamp>`：首次切换边界，后续发布保留原值，不能每次重置。

7 天历史按切换时间拼接：边界之前读取旧 PostgreSQL `monitor_samples`，边界及之后读取 Prometheus，跨边界桶按样本数量合并均值，不重复计算影子运行数据，不伪造迁移前曲线。PostgreSQL 继续负责登录事务、会话、现有应用数据和旧监控历史到期清理。公网 HTTP/HTTPS 仍拒绝旧 `/api/monitor/ingest`，Prometheus 模式停用内部投递；旧凭据只保留供回退。

Google 出网继续通过原 `personal-homepage-monitor-proxy.socket` 的私网 `17891 → 127.0.0.1:17890`；只对 OAuth 请求使用代理。Prometheus relay 使用独立 `19091`，不能覆盖 OAuth socket 或 Study Agent、白板、HTTPS 配置。

## 影子验证、切换与事务回退

始终通过任务 worktree、提交和现有 Jenkins `personal-homepage-deploy` 发布。同一版本的镜像、部署脚本和监控配置通过 Jenkins manifest 携带；网站发布不构建或启动另一个 Prometheus 容器。Prometheus 是独立宿主机服务，配置和脚本内容没有变化时，普通网站部署不会重启抓取服务。

首次准备[Prometheus 官方 3.13.5 发行包](https://github.com/prometheus/prometheus/releases/tag/v3.13.5)：将 `prometheus-3.13.5.linux-amd64.tar.gz` 放到 `/opt/personal-homepage-prometheus/downloads/`，目录由 root 管理。安装器重新校验以下固定 SHA-256，可对照同一官方发行页的 `sha256sums.txt`：

`0388822ace519c5a3a8ef556a541ce1b536e21d872f82deded465bd27a5a0699`

仅从该归档提取两个已知普通文件 `prometheus` 和 `promtool`；拒绝符号链接或异常成员，不允许从任意 URL 静默获取运行文件。升级版本必须同时更新固定版本、校验值和 unit，重新执行验证。

可先使用同版本部署目录执行 `sudo python3 deploy/install-prometheus.py shadow`。该动作事务化安装、启动并验证新服务，保留旧采集器、网站环境和读数据源；成功后只提交新服务安装，尚未切换网站。失败恢复已备份文件及原启停状态。影子验证应包含真实指标、容器和服务检查、约 3 秒 / 15 秒节拍、缺失语义与资源占用。

Jenkins 正式发布按以下顺序执行：

1. `install-server-monitor.py prepare` 备份 OAuth/旧采集器文件与状态，保留已有后端配置；`install-prometheus.py prepare` 独立备份新栈和网站环境，安装并用 `promtool check config` 校验，等待两个 scrape job 成功、两类采样时间新鲜、私网 relay 可查询。
2. 切换前先运行 `verify-monitor-runtime.py --image <目标镜像>`：临时容器运行目标镜像真实的 `/app/server.js` 和编译后的 Next HTTP 路由，只在容器内部回环监听，不发布端口。只读挂载测试 preload，用内存中的固定伪会话和空旧历史替代数据库，既不注入生产数据库/Google 凭据，也不建立真实会话或写库；真实查询私网 Prometheus，要求匿名/伪造会话 401、当前值新鲜、3 个容器/11 个服务、三档历史点数及实际数据通过。无论通过或失败都按唯一 label 删除本次临时容器；该 preload 不挂到生产网站。
3. 上述编译运行时验证通过后，`cutover` 才设置网站环境和首次切换时间；随后按原流程更新网站、白板、HTTP/HTTPS snippet，执行健康检查与 `nginx -t`，保留 Study Agent 和原代理。
4. `verify-server-monitor.py` 验证页面、Google 配置、匿名读取 401、公网采集 404、新鲜 Prometheus 数据、监听地址，并从真实网站容器查询私网指标。
5. `finalize` 再次确认新鲜数据后，停止并禁用 `personal-homepage-monitor.service` 旧推送采集器。最后对两个安装事务 `commit`，完成后清理安装备份。不会删除旧 SQLite、PostgreSQL 表、TSDB 或历史发行二进制。

部署失败时先回退 Prometheus 事务，再回退旧监控/OAuth事务、Nginx 和上一个网站/白板镜像。Prometheus 事务位于 `/var/lib/personal-homepage-prometheus-deployment/`，旧事务位于 `/var/lib/personal-homepage-monitor-deployment/`，均为 0700，备份文件 0600。存在未结束事务时拒绝覆盖；应先核对失败构建和 metadata，再使用匹配版本 `rollback`，不能直接删除目录解除阻塞。

成功 commit 后不能用 `rollback` 任意恢复历史版本。恢复 PostgreSQL 后端时，固定已知良好的网站和白板镜像，使用匹配部署代码恢复原网站环境（或明确设置 `MONITOR_DATA_BACKEND=postgres`），重启旧采集器，再核对当前样本与原数据库；保留新 TSDB 以便恢复。旧 SQLite 的新旧队列均保留，只有仍在原 1 小时窗口内的数据可正常补传；Prometheus 期间没有生成的 PostgreSQL 样本不能凭空补回。

## 只读诊断与验收

```sh
systemctl status personal-homepage-prometheus.service personal-homepage-monitor-exporter.service personal-homepage-prometheus-proxy.socket
journalctl -u personal-homepage-prometheus.service -u personal-homepage-monitor-exporter.service --since '10 min ago'
curl --fail --silent http://127.0.0.1:19090/-/ready
ss -lnt
systemctl show personal-homepage-prometheus.service personal-homepage-monitor-exporter.service -p MainPID -p MemoryCurrent -p MemoryPeak -p TasksCurrent
```

不要输出完整环境、OAuth 响应、Cookie、SQL 连接串或指标原始标签全集。固定 exporter 不读取容器环境或完整健康日志，不添加动态 URL、请求 ID 等高基数标签。

验收必须区分：本地测试、Jenkins 目标提交成功、容器实际版本、真实 Google 登录、授权接口数据与桌面/手机布局。对照宿主机资源命令与 Docker 指定字段，确认 3 秒 / 15 秒连续采样、三档曲线与迁移边界拼接；确认 exporter/Prometheus 中断出现断点和超过 45 秒过期、重启恢复后不填虚假数据，网站或数据库暂时停止时 Prometheus 仍采集。确认公网 IP 的 19090/19091/19100 不可连接，旧 ingest HTTP/HTTPS 404，并核对网站、白板、Study Agent、Jenkins、Perforce 和构建指标正常。7 天 retention 配置可即时检查，真实 7 天到期行为需经过对应运行时间验证。
