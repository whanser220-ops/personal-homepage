# 服务监控运维

入口为 `https://warmhanser.com/server-monitor`，仅监控 `cloud-primary` 一台宿主机。Google 登录和玻璃看板沿用现有网站；同机独立运行 Prometheus、node_exporter、cAdvisor、blackbox_exporter，以及只负责项目特定检查的 Python exporter。未部署 Grafana，不发送外部通知。

## 数据流与采样

采集链路为 `Prometheus → 各回环 exporter → 宿主机 / Docker / 固定服务`；查询链路为 `浏览器 → Google 会话校验后的 Next.js → Docker 私网 relay → Prometheus HTTP API`。浏览器不能直接访问 exporter、Docker socket 或 Prometheus。

| Prometheus job | 来源 | 节拍 / 抓取超时 | 职责 |
| --- | --- | --- | --- |
| `server-monitor-node` | node_exporter，`127.0.0.1:19101` | 3 秒 / 2 秒 | 主机 CPU、负载、内存、Swap、根盘、默认出口网络、运行时间。 |
| `server-monitor-cadvisor` | cAdvisor，`127.0.0.1:19102` | 15 秒 / 5 秒 | 固定生产容器的 CPU 累计计数、内存 working set、内存上限和 `container_last_seen`。 |
| `server-monitor-blackbox` | blackbox_exporter，`127.0.0.1:19103/probe` | 15 秒 / 4 秒 | 4 个固定 HTTP 入口和 2 个 TCP 端口；每项探测最长 3 秒。 |
| `server-monitor-custom` | Python，`127.0.0.1:19104/metrics/custom` | 15 秒 / 8 秒 | Docker 指定元数据、4 个 systemd 进程和 PostgreSQL 就绪检查。 |

`node-host.rules.yml` 每 3 秒把原生 node 指标转换为原有 `server_monitor_host_*` 指标；保留 `host_id=cloud-primary`、`job=server-monitor-host`、`instance=127.0.0.1:19100` 的历史标签。这里的 `19100` 是兼容旧历史的标签，标准模式不需要该端口继续监听。规则只取与 node 时间指标同一抓取帧的数据，并检查 `up` 和实际样本时间；记录规则求值时间不能冒充新采样时间。规则输出沿用原名称与标签，因此继续查询原 Prometheus TSDB 就能显示迁移前后的主机历史，不重建或复制曲线。

Python 不导入旧 `collector.py`，不再读取主机资源、运行 Docker stats 或 HTTP/TCP 探测，也不创建 SQLite、读取投递凭据或向网站推送。一次请求并行执行恰好 3 类固定命令：Docker inspect、批量 systemctl show、容器内 pg_isready；持久线程池最多 3 个 worker，每条命令最长 3 秒。采集锁禁止重叠；14 秒单调时钟缓存避免影子与生产 Prometheus 短暂并行时重复执行命令，并为 15 秒节拍保留 1 秒抖动余量。缓存返回原样本与原 `server_monitor_custom_collected_at_seconds`，不会刷新其年龄。

页面当前值每 3 秒请求，历史每 30 秒请求，切换范围立即加载；1 小时按 3 秒、24 小时按 5 分钟、7 天按 30 分钟聚合。Next.js 读取原始采样矩阵，按各来源的实际抓取帧匹配数据，避免 Prometheus 重启后旧镜像或旧状态标签被 lookback 重新带入。主机时间来自记录指标内的真实 node 抓取时间；检查时间综合 custom 采集时间、cAdvisor 抓取与容器 last_seen、各 blackbox 来源，按最旧或缺失来源判断是否过期。超过 45 秒标记过期，缺失值保留 `null`，不能用 0 或前值补齐断点。

Prometheus 使用独立本机时序数据库，保留 7 天，并设置 1 GB 保留大小上限：达到任一限制后删除较旧 block，故大小上限可能缩短实际历史。大小保留不是整个目录的硬配额，WAL/head 等仍需要额外磁盘余量。不要把运行中的 TSDB 目录作为普通文件直接复制；当前没有远端长期存储或独立服务器告警。

## 指标、服务与故障语义

主机指标由 node_exporter 从 Linux 提供；CPU 及磁盘、网络速度由真实累计计数计算，首帧不足两次计数时不生成速度。内存已用量为总量减 MemAvailable；根盘容量只选 `/`。安装器通过 `findmnt` 的 MAJ:MIN 和 `/sys/dev/block` 定位根设备，并从路由表选最低 metric 的默认出口，把这两个值写入规则，避免累加分区、Docker/veth 或网桥。根设备或默认出口变更后需要重新部署并核对渲染规则，不能假设静态规则会自动跟随改名。

node_exporter 1.12.1 的 netdev collector 需要 `AF_NETLINK`；unit 必须保留该地址族，只有 HTTP 抓取成功并不能证明网络 collector 成功。diskstats 的默认过滤可能排除根分区，安装器须清除默认分区排除并只纳入已发现的根设备；当前主机根分区为 vda2，不能用整盘计数替代。验收需检查 collector 成功标志及 4 项磁盘/网络速度均为当前帧的有效数字，不能仅看 `up=1`。

容器只展示 `personal-homepage`、`learning-whiteboard`、`personal-homepage-postgres`。Python 的固定 Docker inspect 模板只读取完整 ID、镜像、状态、健康状态和重启次数；无 Health 字段时安全返回 unknown。cAdvisor 资源按完整 64 位容器 ID 连接，不按可能复用的名称连接；容器重建后不能混入旧 ID 的资源。容器 CPU 按真实抓取帧之间的累计 CPU 秒差分计算，多核可以超过 100%；首帧、计数回退或中间失败不伪造 CPU。内存使用 working set，未限制的 cgroup 上限 0 使用实际主机内存，有限值也受主机内存约束。

cAdvisor 0.60.6 的 `container_last_seen` 值为导出时看到容器的整秒时间，不是底层 housekeeping 的精确统计时间；CPU 分母使用精确抓取帧时间，不能用该整秒值替代。housekeeping 与抓取均设为 15 秒，但导出仍可能读取缓存统计，不能承诺每帧都有一份新内核观察。缺失或过期的 last_seen 不可冒充新数据，对应资源为 null、检查不完整。该 job 设置 `honor_timestamps: false`，让指标与 `up` 使用同一抓取帧，last_seen 的值作为容器被观察到的存活信息保留。

HTTP 检查、进程检查与 TCP 可达明确区分。blackbox 的 HTTP 模块禁止重定向、不读取环境代理，响应体读取限制为 64 KB；Prometheus 仅保留成功标志、HTTP 状态码和耗时，不保存响应体或探测调试日志。2xx 为 HTTP 检查通过，3xx/401/403 仅说明认证或重定向入口可达。Study Agent 的 303 不直接判故障。固定 HTTP 入口是网站 `/api/health`、白板 `/whiteboard/health`、Jenkins `/login` 和 Study Agent `/`；Jenkins 经原有回环转发检查本机 WSL 控制器，留作回退的旧云端 Jenkins 容器不纳入资源列表。Perforce 1666、远程运行 4321 仅证明 TCP 连接可达。

Python 使用一次 `systemctl show` 仅读取固定 4 个单元的 Id、LoadState、ActiveState，检查 Study Agent、远程运行、Nginx 和 Docker 的进程状态；进程运行不代表 HTTP 业务健康。PostgreSQL 使用容器内固定 `pg_isready -q`，仅在容器内引用非敏感用户与数据库名称，不取回环境或密码。所有结果均为服务器本机视角；exporter 抓取失败显示未知或过期，不把旧健康状态当作新结果。

网站或 PostgreSQL 暂停时，Prometheus 继续抓取并保存其他指标，相应 HTTP/就绪检查可以变为失败；网站查询和登录仍可能不可用。恢复后直接查询保留的数据，不再依赖 SQLite 补传。Prometheus 停止期间不会采样，exporter 停止时其来源缺失；未发生的采样不能补回。整台服务器失联时，同机监控也停止，不能把本机探测当作外部可用性保证。

## 独立部署与访问边界

| 组件 | 安装与访问 |
| --- | --- |
| Prometheus | 官方 Linux amd64 `3.13.5`，二进制位于 `/opt/personal-homepage-prometheus/releases/3.13.5/`；`personal-homepage-prometheus.service` 使用独立 `prometheus-monitor` 用户，无 Docker 权限。 |
| 配置与 TSDB | `/etc/personal-homepage-prometheus/prometheus.yml`、`node-host.rules.yml`、`blackbox.yml`，root 拥有、0644；生产 TSDB 为 `/var/lib/personal-homepage-prometheus/`，服务用户拥有、0700。 |
| Prometheus HTTP | 只监听 `127.0.0.1:19090`，不启用 admin API 或生命周期写入 API。 |
| node_exporter | 固定版本 `1.12.1`，`personal-homepage-node-exporter.service`，独立用户 `monitor-node`，回环 `19101`。仅开启所需主机 collector。 |
| cAdvisor | 固定版本 `0.60.6`，`personal-homepage-cadvisor.service`，宿主机原生 root 服务，回环 `19102`。需要读取 Docker/cgroup；仅启用 CPU/内存，关闭 profiling、容器标签与环境导出。 |
| blackbox_exporter | 固定版本 `0.29.1`，`personal-homepage-blackbox-exporter.service`，独立用户 `monitor-blackbox`，回环 `19103`，仅允许本机出入网络。 |
| Python custom | `/opt/personal-homepage-monitor/custom/exporter.py`，root 拥有、0644；`personal-homepage-monitor-custom.service` 使用 `server-monitor` 和 Docker 补充组，回环 `19104`。不向其提供网站密钥。 |
| 网站查询 relay | `personal-homepage-prometheus-proxy.socket` 仅监听当前 `personal-homepage-net` IPv4 gateway 的 `19091`，由 `systemd-socket-proxyd` 转发到回环 `19090`。不使用公网 IP 或 `0.0.0.0`；仅信任网站所在 Docker 网络。 |
| 网站容器 | 不挂载 Docker socket、不增加宿主机权限；通过 `MONITOR_PROMETHEUS_URL=http://<gateway>:19091` 查询固定指标。Prometheus UI 不增加公网路由。 |
| 影子验证 | `personal-homepage-prometheus-shadow.service` 单独使用 `shadow/prometheus.yml` 和 `/var/lib/personal-homepage-prometheus-shadow/`，回环 `19094`；`personal-homepage-prometheus-shadow-proxy.socket` 只在 Docker gateway `19095` 转发。影子历史仅保留 1 小时、128 MB；验证成功后停止影子进程和 relay，不将其 TSDB 拼接进生产。 |

生产 Prometheus 设置 `GOMEMLIMIT=256MiB`、`MemoryHigh=256M`、`MemoryMax=512M`、`CPUQuota=80%`，即最多 0.8 个 CPU 核心，在当前双核主机上相当于整机的 40%。node、cAdvisor、blackbox、custom 的 MemoryMax 分别为 96/192/96/128 MB，CPUQuota 分别为 15/30/10/20%；这些都是保护上限，不能相加当作实际用量。应查看 cgroup 与 RSS 实测，OOM 或 CPU 限流可能使采样超时并留下缺口。cAdvisor 的 root 身份及 custom 的 Docker 补充组都能访问高权限宿主机接口，必须保护程序与 unit 写权限；网站容器不获得这些权限。

## Google 登录与旧数据

复用 `/etc/study-agent/auth/google-oauth.json`，保留 Study Agent 原有回调，网站回调为 `https://warmhanser.com/api/monitor/auth/google/callback`。沿用 `openid-client` 的 state、PKCE、nonce、Google ID Token 与 `email_verified` 校验；仅允许 `whanser220@gmail.com`，用 Google `sub` 标识用户。会话仍在 PostgreSQL，默认 24 小时，Cookie 为 Secure、HttpOnly、SameSite=Lax；退出立即删除会话，所有读取接口禁止缓存。

`/etc/personal-homepage-monitor/web.env` 为 root:root、0600，父目录 0700。保留原 OAuth、owner、public URL、ingest token，并增加：

- `MONITOR_DATA_BACKEND=prometheus`：选用独立时序存储。
- `MONITOR_EXPORTER_MODE=standard`：按 node 主机兼容指标和各标准来源读取；缺省 `legacy` 仅用于旧统一 Python exporter 回退。
- `MONITOR_PROMETHEUS_URL=http://<gateway>:19091`：只允许固定私网数值地址与端口。
- `MONITOR_PROMETHEUS_CUTOVER_AT=<UTC ISO timestamp>`：首次切换边界，后续发布保留原值，不能每次重置。

首次迁移 Prometheus 的 7 天历史按原切换时间拼接：边界之前读取旧 PostgreSQL `monitor_samples`，边界及之后读取 Prometheus，跨边界桶按样本数量合并均值，不重复计算影子数据，不伪造迁移前曲线。本次替换 exporter 保留原 `MONITOR_PROMETHEUS_CUTOVER_AT`，继续使用生产 TSDB 和相同主机指标标签，不能重新设置边界。PostgreSQL 继续负责登录事务、会话、现有应用数据和旧监控历史到期清理。公网 HTTP/HTTPS 仍拒绝旧 `/api/monitor/ingest`，Prometheus 模式停用内部投递；旧凭据只保留供回退。

Google 出网继续通过原 `personal-homepage-monitor-proxy.socket` 的私网 `17891 → 127.0.0.1:17890`；只对 OAuth 请求使用代理。Prometheus relay 使用独立 `19091`，不能覆盖 OAuth socket 或 Study Agent、白板、HTTPS 配置。

## 影子验证、切换与事务回退

始终通过任务 worktree、提交和现有 Jenkins `personal-homepage-deploy` 发布。同一版本的镜像、部署脚本、规则和监控配置通过 Jenkins manifest 携带；网站发布不构建或启动另一个 Prometheus 容器。Prometheus 和 exporter 均为独立宿主机服务，配置和程序内容没有变化时，普通网站发布不应重启生产抓取服务。

首次准备[Prometheus 官方 3.13.5 发行包](https://github.com/prometheus/prometheus/releases/tag/v3.13.5)：将 `prometheus-3.13.5.linux-amd64.tar.gz` 放到 `/opt/personal-homepage-prometheus/downloads/`，目录由 root 管理。安装器重新校验以下固定 SHA-256，可对照同一官方发行页的 `sha256sums.txt`：

`0388822ace519c5a3a8ef556a541ce1b536e21d872f82deded465bd27a5a0699`

仅从该归档提取两个已知普通文件 `prometheus` 和 `promtool`；拒绝符号链接或异常成员，不允许从任意 URL 静默获取运行文件。升级版本必须同时更新固定版本、校验值和 unit，重新执行验证。

标准 exporter 的发行物也预先放在该 downloads 目录，由 `install-monitor-exporters.py` 的 `ARTIFACTS` 固定版本与 SHA-256 重新验证：

| 组件 | 本次固定发行物 |
| --- | --- |
| node_exporter 1.12.1 | `node_exporter-1.12.1.linux-amd64.tar.gz` |
| cAdvisor 0.60.6 | `cadvisor-v0.60.6-linux-amd64` |
| blackbox_exporter 0.29.1 | `blackbox_exporter-0.29.1.linux-amd64.tar.gz` |

只提取已知普通二进制文件，cAdvisor 还验证 ELF；安装器不从任意 URL 获取程序。升级必须同时维护固定校验值、unit、兼容指标及验收，不以版本号相同替代文件校验。

本次标准 exporter 的并行验证入口是 `sudo python3 deploy/install-monitor-exporters.py shadow`。它只管理新 exporter、单独的影子 Prometheus `19094`、私网 relay `19095` 及其独立配置/TSDB，不修改生产 `19090` 配置、旧统一 Python `19100` 的文件或网站环境；旧服务状态纳入回退快照。成功仅提交这次并行安装，网站仍读取原生产数据源。失败恢复已备份文件及原启停状态。影子验收包括真实 3 秒 / 15 秒节拍、9 个抓取目标（node、cAdvisor、custom 各 1，blackbox 6）、完整 ID 连接、主机规则数值、服务语义、缺失处理和资源占用。

Jenkins 正式发布按以下顺序执行：

1. 备份原 OAuth/网站运行环境，保留已有后端与首次 PostgreSQL 切换边界；准备新 exporter 和独立影子栈。安装器渲染真实根设备/默认网卡，执行 `promtool check config`、`check rules` 和固定数值规则测试，等待原生指标、容器 ID、探测及私网 relay 通过。
2. 切换前运行 `verify-monitor-runtime.py --image <目标镜像> --network personal-homepage-net --exporter-mode standard --prometheus-port 19095`。临时容器使用真实 `/app/server.js` 和编译后的 Next HTTP 路由、标准模式与影子私网数据源，只在容器内部回环监听，不发布端口。只读测试 preload 用内存固定伪会话和空旧历史替代数据库，不注入生产数据库/Google 凭据、不建立真实会话或写库；验证匿名/伪造会话 401、当前值新鲜、3 个容器/11 个服务、三档历史点数及实际数值。无论成功或失败都按唯一 label 清理本次临时容器，preload 不挂载到生产网站。
3. 候选运行时验证通过后，由生产 Prometheus 安装事务备份并更新生产配置/规则，继续使用原 TSDB。`cutover` 设置 `MONITOR_EXPORTER_MODE=standard` 与生产私网 URL，保留原 OAuth 与 `MONITOR_PROMETHEUS_CUTOVER_AT`。随后按原流程更新网站、白板、HTTP/HTTPS snippet，执行健康检查与 `nginx -t`，保留 Study Agent 和原代理。
4. `verify-server-monitor.py` 验证页面、Google 配置、匿名读取 401、公网采集 404、原生来源和主机记录数据新鲜、私有监听地址，并从真实网站容器查询私网指标。还需使用真实 Google 登录检查页面和授权接口，不能把测试会话当作真实登录证明。
5. 验证通过才 `finalize`：停止并禁用旧统一 Python `personal-homepage-monitor-exporter.service`（19100）及更早的推送采集器；停止影子 Prometheus 19094 和其 19095 relay，新 node/cAdvisor/blackbox/custom 继续为生产服务。随后提交各安装事务并清理备份。旧脚本、SQLite、PostgreSQL 表、生产 TSDB 和旧发行二进制均保留。

部署失败时先恢复本次变更的 Nginx，再依次回退生产 Prometheus 事务、新 exporter/影子事务、原监控/OAuth事务，最后重建匹配的网站/白板镜像。事务目录分别为 `/var/lib/personal-homepage-prometheus-deployment/`、`/var/lib/personal-homepage-exporters-deployment/`、`/var/lib/personal-homepage-monitor-deployment/`，均为 0700，备份文件 0600。恢复原文件与服务启停状态，保留 TSDB 和队列；存在未结束事务时拒绝覆盖，先核对失败构建和 metadata，再使用匹配版本 `rollback`，不能直接删除目录解除阻塞。

成功 commit 后不能用 `rollback` 任意恢复历史版本。回退到旧统一 Python 时，恢复匹配版本的 Prometheus 两个抓取 job、网站镜像与 `MONITOR_EXPORTER_MODE=legacy`，启用保留的 19100 服务；继续使用原生产 TSDB、`MONITOR_DATA_BACKEND=prometheus`、原私网 URL 和首次切换边界，验证后再退役新组件。旧运行文件位于 `/opt/personal-homepage-monitor/exporter.py`；不要把当前仅负责 custom 的源码覆盖到该旧路径。

若进一步恢复早期 PostgreSQL 投递后端，则使用匹配部署代码设置 `MONITOR_DATA_BACKEND=postgres`、恢复凭据并重启旧 `personal-homepage-monitor.service`，核对原数据库当前样本。保留新 TSDB，以便恢复。旧 SQLite 的新旧队列均保留，只有仍在原 1 小时窗口内的数据可补传；Prometheus 期间没有生成的 PostgreSQL 样本不能凭空补回。

## 只读诊断与验收

```sh
systemctl status personal-homepage-prometheus.service personal-homepage-node-exporter.service personal-homepage-cadvisor.service personal-homepage-blackbox-exporter.service personal-homepage-monitor-custom.service
journalctl -u personal-homepage-prometheus.service -u personal-homepage-monitor-custom.service --since '10 min ago'
curl --fail --silent http://127.0.0.1:19090/-/ready
ss -lnt
systemctl show personal-homepage-prometheus.service personal-homepage-node-exporter.service personal-homepage-cadvisor.service personal-homepage-blackbox-exporter.service personal-homepage-monitor-custom.service -p MainPID -p MemoryCurrent -p MemoryPeak -p TasksCurrent
```

不要输出完整环境、OAuth 响应、Cookie、SQL 连接串或指标原始标签全集。custom 不读取容器环境或健康日志；cAdvisor 禁止环境与任意容器标签导出，Prometheus 再次只保留所需名称和固定生产容器。blackbox 仅允许受保护回环接口，配置固定本机目标，不公开提供任意 URL 探测。不要添加动态 URL、请求 ID 等高基数标签。

验收必须区分本地测试、Jenkins 目标提交成功、容器实际版本、真实 Google 登录、授权接口数据与桌面/手机布局。对照宿主机命令、Docker 固定字段和资源累计计数，确认 3 秒 / 15 秒连续采样、三档曲线、原 PostgreSQL 边界与既有 Prometheus 历史；核对 3 个容器、11 项服务和认证跳转语义。确认各来源中断产生缺失/过期，记录规则不把旧值重写成新采样；主机恢复、容器重建与 Prometheus 重启后不会混入旧 ID 或旧镜像。网站或数据库短暂停止时，Prometheus 仍应保存其余指标。

生产 19090 和 19101–19104 只监听回环，19091 仅监听 Docker gateway，均不能通过公网 IP 连接；成功退役后 19100 和影子 19094/19095 应停止监听。旧 ingest HTTP/HTTPS 仍为 404；核对网站、白板、Study Agent、Jenkins、Perforce 和构建指标正常。7 天 retention 配置可立即检查，完整到期删除仍需经过对应运行时间；影子运行和短期测试不能证明完整 7 天稳定性。
