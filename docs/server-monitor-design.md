# 原生监控页设计与第三方说明

本页用于个人网站的私有单主机监控。界面为 Next.js / React 与原生 SVG，不加载 Grafana、iframe、ECharts、Chart.js、CDN 或在线字体。Google 登录与现有监控数据接口沿用原实现。

## 参考正本与用途

参考 [Lieflat Charts](https://github.com/larashero3-dotcom/lieflat-charts)，固定版本 `ed436ba56b3cbeee20b9b9966b38a9a9689e239c`。先读取该版本的 `SKILL.md`、`catalog.md`、`mono-tokens.js`，再检查真实 gallery 卡片与对应脚本。结构沿用 Mono 的 Inter、24px 卡片圆角与实色、无阴影的布局；当前全局颜色采用上游 `color-presets.js` 的 **Porcelain 青瓷蓝**，并对照 `templates/basics-porcelain.html` 的对应 F2/F3/F5/F11 渲染。颜色正本在预设，几何正本仍是原版 gallery。

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

## Porcelain 颜色语义与对比度

所有页面 CSS 变量与 SVG 颜色集中于 `src/components/monitorPalette.js`，只使用同一 Porcelain 预设，不混入 Mono、Palm、Wire 的颜色。背景为 `BG #F7F2EB`，正文为 `TXT #081F5C`，主数据 `DATA #334EAC`，中间蓝 `DATA2 #7096D1`，浅蓝 `FAINTDATA #BAD6EB`。小字号使用预设 `LAB rgba(8,31,92,.72)`；未采用对纸色背景仅约 4.20:1 的 `MUT .60`。统一保留现有字号、留白、刻度、折线断点、键盘读数和低频历史更新。

- CPU 与容量队列的已用刻线按固定百分比位置划分三等份，由浅蓝、中蓝至深蓝，色深只表示刻度沿 0–100% 方向的位置；不代表告警阈值或“健康/危险”等级。未用容量的 `TRACK` 是安静的结构底轨，不画深色轮廓；未启用 Swap 和未知值不填充。
- 历史曲线的蓝阶对应固定图例系列与阅读层次，数值仍由纵向位置读取，不拿不同物理量的深浅比较大小。系列同时保留标签与不同虚实线，图例显示与数据线一致的真实线型。选中点有深色轮廓，来源行注明颜色与线型的口径。
- 彩色数据线宽相对于原版统一乘 `1.8`，数据层静态不透明度为 `1`，高于 `.85` 下限；网格、时间刻度与未用容量底轨使用预设辅助角色，表示图表结构。
- 浅蓝 `DATA2` 与 `FAINTDATA` 对纸色的对比度分别约 `2.70:1`、`1.36:1`，因此关键浅蓝数据线、图例线和孤立点均加 `DATA` 深色轮廓；浅色已用刻线也有深色轮廓。加粗本身不被当作达到对比度要求的替代。

按 WCAG 相对亮度公式计算并独立复核：`TXT/BG ≈13.86:1`，`LAB/BG ≈6.09:1`，`DATA/BG ≈6.67:1`。正文与小字超过 `4.5:1`，关键数据轮廓超过 `3:1`。此换肤不新增图表依赖、外部字体、请求或数据计算，也不改认证、轮询和服务检查规则。

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
