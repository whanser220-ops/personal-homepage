# 原生监控页设计与第三方说明

本页用于个人网站的私有单主机监控。界面为 Next.js / React 与原生 SVG，不加载 Grafana、iframe、ECharts、Chart.js、CDN 或在线字体。Google 登录与现有监控数据接口沿用原实现。

## 参考正本与用途

参考 [Lieflat Charts](https://github.com/larashero3-dotcom/lieflat-charts)，固定版本 `ed436ba56b3cbeee20b9b9966b38a9a9689e239c`。先读取该版本的 `SKILL.md`、`catalog.md`、`mono-tokens.js`，再检查真实 gallery 卡片与对应脚本。Mono 的纸色 `#F0EFEB`、墨色 `#1C1C1A`、七级灰阶、Inter、24px 卡片圆角与无材质装饰的结构为基础。小字号改用 ladder 的 `#6A6963`，提高与纸色背景的对比度。

先比较 Lupi Editorial，随后比较 Basics，候选记录如下。卡片路径均相对于上游仓库。

| 编号 | 正本文件 / 卡内标题 | 数据契约与决定 |
| --- | --- | --- |
| L3 Barcode Lollipop | `templates/lupi-gallery.html` / Ninety days as a barcode | 每天一个读数的长日历序列；当前 3 秒采样以及四条不同资源曲线不宜伪装成逐日记录，未采用。 |
| L15 Ballot Tally | `templates/lupi-gallery.html` / What they fear, tick by tick | 多选比例的独立百分比可借鉴，但投票人数语义与主机容量不同；不复制投票点阵，未采用。 |
| F2 Hairline Line | `templates/basics-gallery.html` / Thirty days of sign-ups | 采用真实 `dayline` 细线、时间地板、逐点读数结构，转换为等时间采样序列；路径在 null 处断开，提供指针与键盘精确读数，不保留“周末空心”这种不属于服务器数据的含义。 |
| F3 Hairline Area | `templates/basics-gallery.html` / Concurrent users, filled with days | 采用真实 `hairarea` 的零基线至样本发丝、顶部细线，不用色块面积或渐变。磁盘速率按同一单位显示读写两序列。为避免密集重绘，发丝做确定的等距抽取，顶部线与读数保留全部样本。 |
| F5 Tick Rows | `templates/basics-gallery.html` / Six teams, shipped and counted | 采用真实 `tickrows` 的横向队列、每单位一个 tick、十格辅助点与末端数字；改为内存、Swap、磁盘各自容量的一百分比单位。三项不是同一个总量的组成。未启用 Swap 不画 0/0 百分比。 |
| F11 Tick Gauge | `templates/basics-gallery.html` / How far to the quarter's goal | 采用真实 `gauge` 的 210°、100 根刻线、25/50/75/100 辅助点、端点珠与中央读数；用于 CPU 容量，不套用季度目标和剩余业绩。 |

概览只出现 F11、F5 两个图块，CPU 不在容量队列重复。趋势视图最多四个图块：可选一个 HTTP 指标、容量百分比、磁盘速率、网络速率。时间序列沿用同一 F2 骨架，以相同读数交互比较不同物理量；磁盘用 F3 的发丝结构区分速率形态。没有为了轮换图型加入不适合监控的饼图、网络图或装饰图。版面为应用界面而非单文件图表报告，来源行说明数据来源，模板编号保留在本说明与源码注释。

## 数据与交互边界

- 概览先请求当前主机与 HTTP 信号，两路独立每 3 秒读取；进入趋势后才读取两类历史，每 30 秒读取。服务/容器实际采集仍是 15 秒。隐藏标签暂停请求，返回立即读取；每一路请求设超时、禁止重叠。
- 主机与慢检查独立使用 45 秒过期线；HTTP 入口独立使用接口提供的 9 秒过期线。时间由服务端校准，显示北京时间。401 清理私有显示并停止轮询，退出仍使用原接口。
- null 显示为“—”或“无样本”，0 保持 0。窗口没有样本时显示空态。资源历史仍通过现有接口合并切换前 PostgreSQL 数据与 Prometheus 数据。
- HTTP 无请求、无样本与采集源失联分别说明；无请求时错误率不伪装为 0%。成功与失败请求的延迟分位数分开，延迟 5 分钟窗口与流量/错误率 1 分钟窗口明确标注。
- HTTP、进程与端口检查分组；认证重定向只说明入口可达。Docker CPU 100% 表示一个逻辑核，允许大于 100%；未配置健康检查与未知状态明确区分。
- 本页不提供外部告警、整机失联后的外部观察，也不把单机探测等同于应用的完整功能验证。

## 许可与字体

Lieflat Charts 由“躺在废墟里”开发。所选模板代码及其改编遵循 [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)。此次用途为个人网站的私有研究、实验和爱好监控；该许可不是通用商业授权。再分发所含模板或改编代码时，应保留上述许可 URL 和上游提供的 Required Notice。此说明不改变仓库其他代码各自的权利与许可。

Inter Variable 来自 [Inter 官方字体](https://rsms.me/inter/)，本地文件 `public/fonts/InterVariable.woff2`，SHA-256 `693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3`；许可文件随附于 `public/fonts/Inter-OFL.txt`。使用 `font-display: swap`，中文回退至系统字体，不请求 Google Fonts 或其他外部字体。
