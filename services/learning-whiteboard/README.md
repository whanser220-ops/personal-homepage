# 学习白板 MCP 服务

把学习白板的数据与 Agent 写入能力从 Next.js 主站拆出，作为独立 Node.js 进程运行。主站只通过公开 REST 接口读取场景；Codex 通过带 Bearer token 的 Streamable HTTP MCP 读取和修改同一份数据。数据与历史版本保存在独立持久化目录，重建主站或服务镜像不会覆盖已有白板。

## 运行

需要 Node.js 22 或更新版本，生产 Docker 使用 Node.js 24。依赖版本固定在 package.json 和 package-lock.json。

从本目录启动（PowerShell）：

```powershell
npm ci
$env:WHITEBOARD_MCP_TOKEN = '<从密钥管理器或安全环境变量注入>'
$env:WHITEBOARD_DATA_DIR = './data'
$env:WHITEBOARD_SEED_DIR = '../../public/articles/knowledge-map'
$env:PUBLIC_BASE_URL = 'https://warmhanser.com'
npm start
```

从仓库根目录构建：

```sh
docker build -f services/learning-whiteboard/Dockerfile -t learning-whiteboard-mcp .
docker run -d --name learning-whiteboard \
  --restart unless-stopped \
  --env-file /etc/learning-whiteboard/service.env \
  -p 127.0.0.1:4310:4310 \
  -v /var/lib/learning-whiteboard:/app/data \
  learning-whiteboard-mcp
```

镜像将 `node` 用户的 UID/GID 显式设为 **1001:1001**，宿主挂载目录需给该用户读写权限。`WHITEBOARD_MCP_TOKEN` 必须通过运行时安全环境提供，不能为空，建议至少 32 随机字节。不要把真实 token 放入仓库、镜像、主站前端或 URL。镜像构建执行全部测试，仅复制原始 `.excalidraw` 和 `regions.json` 作为种子，不复制字体和预览图。

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| `WHITEBOARD_MCP_TOKEN` | 无，HTTP 启动必填 | MCP 读写与资源访问的 Bearer token |
| `WHITEBOARD_DATA_DIR` | `data`（相对进程 cwd） | 当前白板、备份和跨进程写锁 |
| `WHITEBOARD_SEED_DIR` | `seed`；镜像中 `/app/seed` | `software-atlas.excalidraw` 和 `regions.json` 种子目录 |
| `PUBLIC_BASE_URL` | `https://warmhanser.com` | 返回给 Agent 的网站链接来源 |
| `HOST` / `PORT` | `0.0.0.0` / `4310` | 独立服务监听地址 |
| `WHITEBOARD_ALLOWED_ORIGINS` | 空 | 额外可信浏览器 Origin，逗号分隔；网站自身 Origin 已允许 |

## Codex 接入

MCP URL：`https://warmhanser.com/whiteboard/mcp`。使用 MCP Streamable HTTP，无会话 ID，不需要保持 SSE GET 连接。所有 MCP 请求都必须带 `Authorization: Bearer ...`。反向代理应保留 Authorization、Accept、Content-Type 和 MCP 协议请求头，并将 `/whiteboard/health`、`/whiteboard/api/`、`/whiteboard/mcp` 路由到本服务。

Codex `config.toml` 示例：

```toml
[mcp_servers.learning_whiteboard]
url = "https://warmhanser.com/whiteboard/mcp"
bearer_token_env_var = "WHITEBOARD_MCP_TOKEN"
```

在启动 Codex 的进程环境中安全设置 `WHITEBOARD_MCP_TOKEN`，之后重开 Codex 以加载服务器配置。其他 Agent 客户端可使用同一 URL 与 Bearer 请求头。

可选本机 stdio 接入：

```toml
[mcp_servers.learning_whiteboard_local]
command = "node"
args = ["/absolute/path/services/learning-whiteboard/src/stdio.js"]

[mcp_servers.learning_whiteboard_local.env]
WHITEBOARD_DATA_DIR = "/absolute/path/whiteboard-data"
WHITEBOARD_SEED_DIR = "/absolute/path/repository/public/articles/knowledge-map"
PUBLIC_BASE_URL = "https://warmhanser.com"
```

stdio 的权限边界是本机进程及文件权限，不经过 HTTP Bearer 认证。两种入口使用相同存储格式和跨进程写锁；部署建议每个数据目录运行一个 HTTP 实例。客户端应从工具列表发现输入 schema。

## Agent 工具

| 工具 | 用途 |
| --- | --- |
| `whiteboard_list` | 分页列出白板、当前 revision、元素/区域数量及网站链接 |
| `whiteboard_get` | 读取 revision、区域和元素；支持 regionId、offset、limit、summary、includeFiles |
| `whiteboard_search` | 在 text/link 中做字面字符串搜索，返回元素 ID、区域和定位链接 |
| `whiteboard_create` | 以唯一 ID 新建公开白板，默认空场景，已有 ID 返回冲突 |
| `whiteboard_add_note` | 根据文本、坐标和颜色添加可直接显示的文字便签，无需手写 Excalidraw 字段 |
| `whiteboard_update` | 按 ID upsert 完整元素或删除指定元素，可选替换标题/regions |
| `whiteboard_replace` | **破坏性操作**：完整替换 scene 和 regions，未包含的原内容会移除 |

所有已有白板写入都需要 `expectedRevision`。先读后写；遇到 `REVISION_CONFLICT` 必须重新读取并重新判断修改，不能直接把 revision 加一重试。冲突错误包含 `currentRevision`。成功响应包含新的 revision 和页面 URL。

`whiteboard_get` 默认 `summary=true`、每页 100 元素，最多 200 元素。摘要返回元素类型、坐标、text/link，不返回 appState、图片文件和全部样式，长文本截取前 1000 字符。修改已有元素时先用 `summary=false` 读取完整元素。需要嵌入图片时显式 `includeFiles=true`；完整存储 JSON 也可通过资源 `whiteboard://boards/{id}` 获取。资源 `whiteboard://instructions` 提供操作约定。区域选择采用显式 elementIds 加与 bounds 相交的元素，`all` 表示全图。

例如添加中文学习便签：

```json
{
  "name": "whiteboard_add_note",
  "arguments": {
    "id": "software-atlas",
    "expectedRevision": 1,
    "text": "进程持有运行状态\n线程执行进程中的任务",
    "x": 100,
    "y": 5100,
    "width": 420,
    "color": "yellow"
  }
}
```

新建板也可直接提供最小 Excalidraw 场景（网站读取时恢复标准显示默认值）：

```json
{
  "name": "whiteboard_create",
  "arguments": {
    "id": "learning-demo",
    "title": "学习示例",
    "scene": {
      "type": "excalidraw",
      "version": 2,
      "elements": [
        {"id":"node-1","type":"rectangle","x":100,"y":100,"width":240,"height":120,"backgroundColor":"#d0ebff"},
        {"id":"label-1","type":"text","x":120,"y":140,"width":200,"height":30,"text":"核心对象","fontSize":24,"fontFamily":3}
      ],
      "appState": {"viewBackgroundColor":"#ffffff"},
      "files": {}
    },
    "regions": {
      "canvas": [0,0,1000,800],
      "regions": [{"id":"core","label":"核心对象","bounds":[80,80,300,180],"elementIds":["node-1","label-1"],"anchorIds":[]}]
    }
  }
}
```

`whiteboard_update.upsertElements` 接受完整元素对象，保留未修改元素、appState、files 和其他场景字段；同一个元素 ID 不能同时 upsert 和 remove。替换已有元素时递增该元素的 Excalidraw version；未触及元素逐字段保持不变。`regions` 保留原 `{canvas, regions:[...]}` 结构，传入时整体替换；删除元素不会自动修改区域的 elementIds。画出新内容后可调整区域 bounds/canvas，让网站准确定位。

## HTTP 接口

| 方法 / 路径 | 认证 / 返回 |
| --- | --- |
| `GET /whiteboard/health` | 公开；`{ok,status,service,version,boardCount,revisions}` |
| `GET /whiteboard/api/boards` | 公开；`{boards:[...]}` |
| `GET /whiteboard/api/boards/:id` | 公开；`{id,title,revision,scene,regions,updatedAt}` |
| `GET /whiteboard/api/boards/:id/export` | 公开；下载 `.excalidraw` 场景 |
| `POST /whiteboard/mcp` | 强制 Bearer；官方 SDK 无状态 Streamable HTTP |
| `GET/DELETE /whiteboard/mcp` | 认证后返回 405，`Allow: POST` |

这些白板与文件下载是网站公开内容，Agent 不应存入秘密。HTTP 不提供公开 REST 写入端点。网站同源反向代理无需跨域授权；带非可信 Origin 的 MCP 请求会拒绝。服务不记录 token。

ID 限定为 1–80 位小写字母、数字、下划线或连字符，首位必须字母或数字；禁止路径穿越。每个白板完整 JSON 最大 8 MiB、最多 10000 元素、500 区域，验证 Excalidraw v2 场景、有限坐标及唯一元素/区域 ID。请求正文上限为 9 MiB。

## 持久化与恢复

```text
data/
  boards/software-atlas.json
  backups/software-atlas/revision-1.json
  backups/software-atlas/revision-2.json
```

第一次启动仅在 `software-atlas` 不存在时导入种子，保留原始 **253 元素**及区域；后续启动不会覆盖。缺少 seed 时服务仍可运行并允许新建空白板。

写操作在进程内串行并使用 `proper-lockfile` 跨进程锁。锁目录使用 mtime 心跳（2 秒），10 秒未更新视为旧锁，重试窗口超过该时间；容器崩溃后可自动恢复，不依赖旧容器 hostname 或 PID。每次写入先检查 revision，保存旧版本备份，再对新 JSON 做临时文件写入、文件 fsync 和原子 rename；Linux 另对父目录 fsync。读者只会读到完整的旧或新文件。备份保留全部历史版本，运维应监控持久化磁盘容量。

回滚时先停止服务，备份当前整个数据目录，再将选定 `backups/<id>/revision-N.json` 复制到 `boards/<id>.json`，确认 JSON 完整后重启。正常 Agent 修改应使用带 revision 的工具，不直接编辑存储文件。

## 验证

```sh
npm test
```

测试覆盖真实种子不覆盖、跨 store 并发 CAS 只有一个成功、增量修改保留其他元素、持久化重启、旧锁恢复、ID/场景/大小约束、完整替换备份、HTTP 认证，以及官方 SDK 客户端真实初始化、列工具、调用、列/读资源和 stdio。还会验证 MCP 更新后公开 REST、导出和健康接口看到相同 revision。
