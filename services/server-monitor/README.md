# 宿主机服务监控采集组件

标准模式使用同机独立的 Prometheus 3.13.5 保存 7 天指标；主看板已改为 [Grafana 13.2.4](grafana/README.md)，保留原 Google 登录和网站导航，以四个黄金信号组织实时概览、趋势与基础设施三块原生看板。Grafana 仅监听 `127.0.0.1:19110`，Nginx 每次请求校验原会话并固定 Viewer 权限。真实 HTTP 指标 exporter 监听 19111，见 [HTTP 指标说明](HTTP_METRICS.md)。Prometheus 监听 `127.0.0.1:19090`；原 Next.js 兼容接口继续通过 Docker 私网 gateway 的 `19091` relay 查询，网站容器不挂载 Docker socket。全部服务探测均为服务器本机视角，不承诺服务器整体失联时的外部告警。

| 组件 | 回环端口 | Prometheus 节拍 | 当前职责 |
| --- | --- | --- | --- |
| node_exporter 1.12.1 | 19101 | 3 秒 | 主机 CPU、负载、内存、Swap、根盘、默认出口网络与运行时间。 |
| cAdvisor 0.60.6 | 19102 | 15 秒 | 3 个固定生产容器的 CPU 累计计数、内存 working set、有效内存上限和 last_seen。 |
| blackbox_exporter 0.29.1 | 19103 | 15 秒 | 网站、白板、Jenkins、Study Agent 的 HTTP；Perforce 1666、远程运行 4321 的 TCP。 |
| Python custom | 19104 | 15 秒 | Docker ID/镜像/状态/健康/重启次数，4 项 systemd 与 PostgreSQL 就绪检查。 |

Prometheus 决定抓取频率；页面当前值每 3 秒刷新，历史每 30 秒查询。node 的 recording rules 每 3 秒生成原有 `server_monitor_host_*` 指标，保留 `job=server-monitor-host`、`instance=127.0.0.1:19100` 与 `host_id=cloud-primary`，继续使用原 TSDB 和历史查询。兼容标签中的 19100 不代表旧 Python 端口还需开放。规则检查真实 node 抓取时间、`up` 和同帧指标，不以规则求值时间刷新旧数据。

node unit 允许 netdev 所需的 `AF_NETLINK`；安装器从真实 MAJ:MIN/sysfs 发现根设备，清除 diskstats 默认分区排除并只纳入该设备，再渲染规则。默认出口同样按宿主机路由发现。不能只看 node `up=1`，还需验证 collector 成功及磁盘/网络速度都有效，避免权限或默认过滤让数据长期缺失。

容器按完整 64 位 ID 连接 custom 元数据与 cAdvisor 资源，重建后不混用旧 ID。CPU 按真实抓取帧间的累计 CPU 秒差分计算，首帧、计数回退或中间失败保留未知；多核可超过 100%。cAdvisor 的 `container_last_seen` 为导出时的容器存活信息，不是 housekeeping 精确时间，不能用于 CPU 分母；15 秒 housekeeping 的缓存仍可能影响逐帧变化。未限制的 cgroup 内存上限 0 映射实际主机内存。抓取设置 `honor_timestamps: false`，以便与 `up` 同帧匹配；缺失或过期 last_seen 不伪造资源。

blackbox HTTP 不跟随重定向、响应体限 64 KB，仅保存成功标志、状态码与耗时。2xx 表示 HTTP 检查通过；3xx/401/403 只表示认证或跳转入口可达，Study Agent 303 不判为故障。TCP 成功只证明连接可达；systemd active 只证明进程运行；pg_isready 只说明 PostgreSQL 接受连接。来源失败或缺失显示未知/断点，最旧或缺失检查超过 45 秒标为过期，不用零或前值填补。

完整部署、Google 登录配置、文件权限、事务回退及发布验收见[服务监控运维说明](../../docs/server-monitor-operations.md)。

## Python custom 的边界与指标

当前 `exporter.py` 是独立的 Python 标准库程序，不导入旧 `collector.py`，不采集主机资源、不运行 Docker stats、HTTP/TCP、SQLite 或推送。`/health` 仅检查程序可响应，`/metrics/custom` 才执行受限采集；旧 `/metrics/host`、`/metrics/checks` 已移除。

一次采样最多并行运行 3 个固定命令任务，每个最长 3 秒：

- `docker inspect --format <固定模板>`：只针对网站、白板、PostgreSQL，读取 ID、名称、镜像、状态、健康状态和重启次数。Health 字段不存在时安全返回 unknown，不读取环境或完整健康日志。
- 一次 `systemctl show`：只读取 Study Agent、远程运行、Nginx、Docker 四个固定单元的 Id、LoadState、ActiveState。
- 容器内固定 `pg_isready -q`：只在容器内引用非敏感用户/数据库名称，不提供或取回密码，不把命令输出存入指标。

采集锁禁止重叠，最多 3 个持久 probe worker、4 个 HTTP 请求 worker；14 秒单调时钟缓存去重并为正常 15 秒节拍保留抖动余量。缓存返回原 bytes 与原采集时间，不使旧结果变新。缺失的数字不导出；不可用容器 ID 不生成标签。

| 指标 | 标签与含义 |
| --- | --- |
| `server_monitor_custom_collected_at_seconds` | `host_id`；实际批次开始时间，不是响应或查询时间。 |
| `server_monitor_custom_container_info` | `host_id,name,container_id,image,state,health`；值 1，完整 ID 缺失时省略该标签。 |
| `server_monitor_custom_container_restart_count` | `host_id,name,container_id`；计数未知时省略指标。 |
| `server_monitor_custom_service_info` | `host_id,id,name,kind,status,detail`；仅 5 项 process 检查，值 1。 |

## 部署、影子验证与登录

`personal-homepage-node-exporter.service`、`personal-homepage-cadvisor.service`、`personal-homepage-blackbox-exporter.service`、`personal-homepage-monitor-custom.service` 均独立部署。当前 custom 安装到 `/opt/personal-homepage-monitor/custom/exporter.py`，新 unit 使用 `--port=19104`；旧统一 Python 的 19100 路径和 unit 在验证期间保留，不用当前 custom 文件覆盖它。

安装入口为 `deploy/install-monitor-exporters.py`；官方发行包及固定 SHA-256 见安装器和运维说明。`shadow` 启动新的 exporter、独立 Prometheus `19094` 与 Docker 私网 relay `19095`，使用独立配置/TSDB，不改生产 Prometheus `19090`、网站环境或旧 19100 文件。Jenkins 验证编译后网站接口、真实数据与权限后才切换生产配置；正式 `MONITOR_EXPORTER_MODE=standard`，保持 `MONITOR_DATA_BACKEND=prometheus` 和生产 URL。验证后停用旧统一 Python 与影子 Prometheus/relay，新 exporter 继续服务。正常网站发布不应因配置未变而重启生产采集。

Google OIDC 和 24 小时数据库会话仍由网站/PostgreSQL 负责，owner 仍为 `whanser220@gmail.com`。首次 PostgreSQL→Prometheus 的 `MONITOR_PROMETHEUS_CUTOVER_AT` 保持原值，边界前旧数据库与边界后生产 TSDB 按样本数拼接；本次 exporter 替换不重置边界，不把影子 TSDB 复制进生产。

```sh
sudo python3 deploy/install-monitor-exporters.py shadow
sudo systemctl status personal-homepage-prometheus.service personal-homepage-node-exporter.service personal-homepage-cadvisor.service personal-homepage-blackbox-exporter.service personal-homepage-monitor-custom.service
sudo journalctl -u personal-homepage-prometheus.service -u personal-homepage-monitor-custom.service --since '10 min ago'
curl --fail --silent http://127.0.0.1:19090/-/ready
```

网站或数据库短暂不可用不会中断其他指标的采集，但登录和看板仍依赖网站与数据库。Prometheus 停止期间没有采样，无法依靠 SQLite 补回；整台服务器失联也无法通过同机组件告警。回退、目录权限、资源限制、私网边界和真实验收步骤以[运维说明](../../docs/server-monitor-operations.md)为准。

## 当前离线验证

```sh
python3 -m unittest discover -s services/server-monitor -p 'test_exporter.py' -v
node --test tests/monitorPrometheus.test.mjs tests/monitorStandardChecks.test.mjs
```

custom 测试包含真实 CLI 子进程、HTTP 路径、systemd ExecStart 参数解析、固定 Docker 字段与缺失 Health、受限命令、未知值、去重缓存和非重叠行为。标准来源适配测试包含完整 ID、原始帧、缺失和故障语义；规则数值测试由安装器使用 `promtool` 在渲染后的固定夹具上执行。离线通过不能替代真实云端指标、编译后镜像、Jenkins 目标提交、真实 Google 登录和页面布局验收。

## 旧统一 Python exporter（仅回退）

已部署的旧程序 `/opt/personal-homepage-monitor/exporter.py`、其 `collector.py` 依赖和 `personal-homepage-monitor-exporter.service`（19100）仅为回退保留；本仓库当前 `exporter.py` 已改为 custom，不能直接覆盖旧路径。回退必须使用匹配版本程序、旧 Prometheus 抓取配置和 `MONITOR_EXPORTER_MODE=legacy`，保留生产 TSDB 和原历史边界。成功 commit 后不能用事务 `rollback` 任意恢复历史版本。

## 旧推送采集器（仅回退）

本节及以下全部子节描述已停用的推送采集器，包括旧 unit、SQLite、投递和启动命令，仅供确认回退方案后使用。Prometheus 模式不能手工启用第二套推送服务。旧程序、队列和 PostgreSQL 历史保留；当前历史按 `MONITOR_PROMETHEUS_CUTOVER_AT` 拼接旧数据库和新时序数据。

### 旧版安装约定

部署脚本负责创建系统账号 `server-monitor`、目录和服务，安装路径如下：

| 内容 | 位置与权限 |
| --- | --- |
| 采集程序 | `/opt/personal-homepage-monitor/collector.py`，root 拥有、0644，由 Python 解释器运行 |
| systemd 单元 | `/etc/systemd/system/personal-homepage-monitor.service` |
| 独立采集凭据 | `/etc/personal-homepage-monitor.env`，root:root、0600，参考 `monitor.env.example` |
| SQLite 和进程锁 | `/var/lib/personal-homepage-monitor/`，server-monitor 拥有、0700 |

`MONITOR_INGEST_TOKEN` 至少 32 个无空白随机字符，与网站运行环境的采集凭据一致。凭据仅从服务环境读取，不能写进程序、URL、日志或 Git。服务通过 systemd `EnvironmentFile` 加载此文件。网站数据库、Google 登录所需凭据不提供给采集器。

systemd 使用独立用户并加入 `docker` 补充组，仅通过 Docker CLI 读取固定字段和执行固定的 `pg_isready -q` 检查。**Docker socket 的权限等同于宿主机管理员权限**；独立用户和 systemd 加固限制普通文件访问，但不能把 Docker socket 变成只读权限。必须保护采集器代码、环境文件和服务单元的写权限。无需将账号加入 sudoers。

以下启动命令仅适用于已恢复旧网站后端、确认使用 PostgreSQL 投递模式的回退窗口：

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now personal-homepage-monitor.service
sudo systemctl status personal-homepage-monitor.service
sudo journalctl -u personal-homepage-monitor.service --since '10 min ago'
```

默认从 `/proc/net/route` 选择最低 metric 的默认出口，并忽略 Docker/veth/网桥/常见隧道接口；可在环境文件设置 `MONITOR_NETWORK_INTERFACE=ens3` 指定出口。不会累加各接口流量，避免 Docker 容器网络重复计算。

### 旧版指标和健康检查

- CPU 从 `/proc/stat` 差分，平均负载来自 `/proc/loadavg`；内存和 Swap 来自 `/proc/meminfo`。CPU 百分比为整台宿主机 0–100%；容器 CPU 使用 Docker 的 CPU 百分比，多核可超过 100%。
- 根盘容量使用 `statvfs('/')`，磁盘吞吐量只对根文件系统设备的 `/proc/diskstats` 计数差分，不重复累加整盘、分区和 device-mapper。扇区按 Linux diskstats 的 512 字节计算。根设备不能定位时，吞吐量为 `null`。
- 网络吞吐量、磁盘吞吐量和 CPU 百分比首帧、采集器重启后的首帧均为 `null`；计数回退或出口切换后保留 `null`，不会把回退显示成负数或零。
- Docker 只查询网站、学习白板和 PostgreSQL 三个固定生产容器的名称、镜像、状态、健康状态、重启次数和资源统计，不读取环境变量或 health-check 日志。不存在或读取失败的字段为 `null` / `unknown`。Jenkins 控制器已迁到本机 WSL，其健康状态由云端 `http://127.0.0.1:8080/login` 转发探针判断；留作回退的云端旧 Jenkins 容器不再参与当前容器采样。
- HTTP 不跟随重定向、不读取响应 body。2xx 表示 HTTP 检查通过；3xx、401、403 仅表示 HTTP 端点可达。Study Agent 的 303 登录跳转不会被误报为故障。
- systemd 每轮通过一次 `show` 查询固定的四个服务，仅读取 `Id`、`LoadState`、`ActiveState`，分别显示 Study Agent、远程运行、Nginx 和 Docker 的进程状态；只证明进程在运行。单个服务缺失不影响其他服务的结果，查询超时或结果缺失显示未知。PostgreSQL 使用容器内 `pg_isready -q`，通过固定脚本引用容器内 `POSTGRES_USER` 和 `POSTGRES_DB`（默认 PostgreSQL 镜像的 postgres 身份），不提供数据库密码，避免把容器 root 用户当数据库角色持续写入 FATAL 日志。
- 远程运行的 4321 和 Perforce 的 1666 仅做 TCP 探测，成功为 `reachable`，不声称业务健康。网站、白板和 Jenkins 使用固定的本机 HTTP URL。

主线程只采集轻量宿主机指标、维护 SQLite 并调度任务；长采样跳过错过的 tick，不并发追赶。文件锁同时阻止手工运行与服务重叠。慢检查批次并行执行，Docker stats 最多等待 5 秒，其他命令/HTTP/TCP 最多等待 3 秒；同一时刻最多一批慢检查，超时不会触发重叠批次。

采集器复用三个有界线程池：一个慢批调度 worker、四个探测 worker、一个投递 worker。慢批调度不会占用探测池等待自身子任务。投递只拿不可变批次，不访问 SQLite；成功 ACK 回主线程处理，最多一个请求在途。慢快照完成后仅附在下一条主机样本上一次，`checksCollectedAt` 记录慢批开始时间；主机更新不会把旧检查标成新检查。退出时持久化已完成结果，等待有界任务结束并关闭线程池。

本机 HTTP 请求使用手工构造的 HTTP-only opener，每个线程独立缓存并复用。它不创建默认 HTTPS handler 或 TLS/CA 上下文，不读取环境代理，不支持 HTTPS、FTP、file 协议，也不跟随重定向。复用的是 opener 和 handler，不代表建立了 TCP 连接池；网站 Google OAuth 的 HTTPS 出网不受此采集器调整影响。

### 旧版缓存、补传和回退

每个样本先持久化到 SQLite，再发往网站。只有收到 2xx 才删除已经确认的一批；超时、网络错误、拒绝、重定向、网站或数据库不可用均保留原始样本，下一轮重新发送。`hostId + collectedAt` 是幂等键，后端必须以这两个字段去重；同一批请求已经写库却丢失响应时，补传不会产生重复记录。

缓存最多保留 1 小时。SQLite 自动回收空页，最大数据库页数限制为 20 MiB，负载量限制为 8 MiB，为索引和删除日志预留空间。超过时间或容量会清理最老样本并记录清理数量，不会记录 payload 或凭据。3 秒节拍下一小时约 1,200 条，大部分只带主机指标，慢检查约 240 份，不会每 3 秒复制一份 Docker / 服务快照。每批补传最多 20 条，恢复耗时取决于接口延迟与缓存量；保留期之外的旧样本按约定过期。

停止服务即可回退采集器，保留状态目录用于诊断或恢复，不要删除网站历史数据：

```sh
sudo systemctl disable --now personal-homepage-monitor.service
```

新版队列是同一状态目录中的 `queue-v2.sqlite3`。启动时只读导入旧 `queue.sqlite3` 中仍在一小时窗口内的数据，原文件不修改；重复导入由队列键与服务端幂等约束去重。回退旧程序时它继续使用原队列；新格式积压留在 v2 文件，后续升级可继续投递。不要删除任一队列来解除失败或清理工作区。

不要在运行中的服务旁使用其他用户执行 `--once`；如确需单次诊断，先停止服务，并以相同用户和环境运行，避免改变状态目录权限。

### 旧版离线验证

```sh
python3 -m unittest discover -s services/server-monitor -p 'test_*.py' -v
```

测试覆盖真实差分、首帧与计数回退、根盘单设备选择、Docker 白名单、认证跳转与 TCP 检查的语义，以及持久队列重启、重试、幂等、1 小时过期、容量和批量补传。另通过真实回环 HTTP 服务器验证 opener 不创建 TLS、不读代理环境、拒绝非 HTTP 协议、认证状态可达且 Bearer 不随重定向外送；验证线程内复用、线程间隔离、四 worker 池跨轮复用、长采样不重叠追赶，以及 systemd 批次的缺失与失败处理。线上还需对照宿主机命令核对数值，并验证公网 HTTP/HTTPS 入口不能访问采集接口；这不是采集器本地测试能够证明的。
