# 宿主机服务监控采集器

Ubuntu 24.04 宿主机上的 Python 3 标准库服务，每 15 秒产生一个 `cloud-primary` 样本，通过 `http://127.0.0.1:3000/api/monitor/ingest` 发送 `{ "samples": [...] }`（每批最多 20 条）。网站只接收采样，不挂载 Docker socket。所有探测均为服务器本机视角。

完整部署、Google 登录配置、文件权限、事务回退及发布验收见[服务监控运维说明](../../docs/server-monitor-operations.md)。

## 安装约定

部署脚本负责创建系统账号 `server-monitor`、目录和服务，安装路径如下：

| 内容 | 位置与权限 |
| --- | --- |
| 采集程序 | `/opt/personal-homepage-monitor/collector.py`，root 拥有、0644，由 Python 解释器运行 |
| systemd 单元 | `/etc/systemd/system/personal-homepage-monitor.service` |
| 独立采集凭据 | `/etc/personal-homepage-monitor.env`，root:root、0600，参考 `monitor.env.example` |
| SQLite 和进程锁 | `/var/lib/personal-homepage-monitor/`，server-monitor 拥有、0700 |

`MONITOR_INGEST_TOKEN` 至少 32 个无空白随机字符，与网站运行环境的采集凭据一致。凭据仅从服务环境读取，不能写进程序、URL、日志或 Git。服务通过 systemd `EnvironmentFile` 加载此文件。网站数据库、Google 登录所需凭据不提供给采集器。

systemd 使用独立用户并加入 `docker` 补充组，仅通过 Docker CLI 读取固定字段和执行固定的 `pg_isready -q` 检查。**Docker socket 的权限等同于宿主机管理员权限**；独立用户和 systemd 加固限制普通文件访问，但不能把 Docker socket 变成只读权限。必须保护采集器代码、环境文件和服务单元的写权限。无需将账号加入 sudoers。

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now personal-homepage-monitor.service
sudo systemctl status personal-homepage-monitor.service
sudo journalctl -u personal-homepage-monitor.service --since '10 min ago'
```

默认从 `/proc/net/route` 选择最低 metric 的默认出口，并忽略 Docker/veth/网桥/常见隧道接口；可在环境文件设置 `MONITOR_NETWORK_INTERFACE=ens3` 指定出口。不会累加各接口流量，避免 Docker 容器网络重复计算。

## 指标和健康检查

- CPU 从 `/proc/stat` 差分，平均负载来自 `/proc/loadavg`；内存和 Swap 来自 `/proc/meminfo`。CPU 百分比为整台宿主机 0–100%；容器 CPU 使用 Docker 的 CPU 百分比，多核可超过 100%。
- 根盘容量使用 `statvfs('/')`，磁盘吞吐量只对根文件系统设备的 `/proc/diskstats` 计数差分，不重复累加整盘、分区和 device-mapper。扇区按 Linux diskstats 的 512 字节计算。根设备不能定位时，吞吐量为 `null`。
- 网络吞吐量、磁盘吞吐量和 CPU 百分比首帧、采集器重启后的首帧均为 `null`；计数回退或出口切换后保留 `null`，不会把回退显示成负数或零。
- Docker 只查询四个固定容器的名称、镜像、状态、健康状态、重启次数和资源统计，不读取环境变量或 health-check 日志。不存在或读取失败的字段为 `null` / `unknown`。
- HTTP 不跟随重定向、不读取响应 body。2xx 表示 HTTP 检查通过；3xx、401、403 仅表示 HTTP 端点可达。Study Agent 的 303 登录跳转不会被误报为故障。
- systemd 每轮通过一次 `show` 查询固定的四个服务，仅读取 `Id`、`LoadState`、`ActiveState`，分别显示 Study Agent、远程运行、Nginx 和 Docker 的进程状态；只证明进程在运行。单个服务缺失不影响其他服务的结果，查询超时或结果缺失显示未知。PostgreSQL 使用容器内 `pg_isready -q`，通过固定脚本引用容器内 `POSTGRES_USER` 和 `POSTGRES_DB`（默认 PostgreSQL 镜像的 postgres 身份），不提供数据库密码，避免把容器 root 用户当数据库角色持续写入 FATAL 日志。
- 远程运行的 4321 和 Perforce 的 1666 仅做 TCP 探测，成功为 `reachable`，不声称业务健康。网站、白板和 Jenkins 使用固定的本机 HTTP URL。

采样与探测都有超时；一次采样完成后才开始下一次，长采样跳过错过的 tick，不并发追赶。文件锁同时阻止手工运行与服务重叠。探测批次并行以控制总耗时，Docker stats 最多等待 5 秒，其他命令/HTTP/TCP 最多等待 3 秒。

采集器启动时创建一个最多四个 worker 的线程池，在采样轮次间复用。主线程提交独立探测并等待结果，worker 不向同一线程池提交子任务再等待；SQLite 和投递仍由主线程执行，退出时等待探测结束并关闭线程池。

本机 HTTP 请求使用手工构造的 HTTP-only opener，每个线程独立缓存并复用。它不创建默认 HTTPS handler 或 TLS/CA 上下文，不读取环境代理，不支持 HTTPS、FTP、file 协议，也不跟随重定向。复用的是 opener 和 handler，不代表建立了 TCP 连接池；网站 Google OAuth 的 HTTPS 出网不受此采集器调整影响。

## 缓存、补传和回退

每个样本先持久化到 SQLite，再发往网站。只有收到 2xx 才删除已经确认的一批；超时、网络错误、拒绝、重定向、网站或数据库不可用均保留原始样本，下一轮重新发送。`hostId + collectedAt` 是幂等键，后端必须以这两个字段去重；同一批请求已经写库却丢失响应时，补传不会产生重复记录。

缓存最多保留 1 小时。SQLite 自动回收空页，最大数据库页数限制为 20 MiB，负载量限制为 8 MiB 为索引和删除日志预留空间。超过时间或容量会清理最老样本并记录清理数量，不会记录 payload 或凭据。正常每 15 秒仅约 240 条样本。每轮补传最多 20 条，恢复后通常约 3 分钟清空满 1 小时积压，同时继续采样；保留期之外的旧样本按约定过期。

停止服务即可回退采集器，保留状态目录用于诊断或恢复，不要删除网站历史数据：

```sh
sudo systemctl disable --now personal-homepage-monitor.service
```

升级替换程序和单元后重新启动；SQLite 在同一状态目录持续使用。不要在运行中的服务旁使用其他用户执行 `--once`；如确需单次诊断，先停止服务，并以相同用户和环境运行，避免改变状态目录权限。

## 离线验证

```sh
python3 -m unittest discover -s services/server-monitor -p 'test_*.py' -v
```

测试覆盖真实差分、首帧与计数回退、根盘单设备选择、Docker 白名单、认证跳转与 TCP 检查的语义，以及持久队列重启、重试、幂等、1 小时过期、容量和批量补传。另通过真实回环 HTTP 服务器验证 opener 不创建 TLS、不读代理环境、拒绝非 HTTP 协议、认证状态可达且 Bearer 不随重定向外送；验证线程内复用、线程间隔离、四 worker 池跨轮复用、长采样不重叠追赶，以及 systemd 批次的缺失与失败处理。线上还需对照宿主机命令核对数值，并验证公网 HTTP/HTTPS 入口不能访问采集接口；这不是采集器本地测试能够证明的。
