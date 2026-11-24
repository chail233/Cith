# 通用配置

[使用索引](../README.md#快速开始)

两层，`git pull` 永不覆盖用户配置：

- `packages/core/config.js` —— 默认值层，随仓库分发，可提交
- `packages/core/config.json` —— 用户配置层，**gitignored**（可用 `CITH_CONFIG` 指向仓库外的文件）

合并规则：标量与数组整体覆盖；普通对象只覆盖写了的字段；`mcpServers` 是唯一按 `name` 增量合并的数组；`members` 写成 `{"QQ号": "昵称"}`；`$` / `_` 开头的键是注释；解析失败直接中止启动，不静默降级。旧版大写键自动迁移为 camelCase。

运行期 `config` 由 Proxy 包裹，顶层键赋值会读-改-写回 `config.json`（面板热改即走这里）。启动自检会检查关键项是否仍是模板占位符，把「致命 / 提示」两级问题写入面板「运行状态」页——避免配置没填对却看着一切正常。

主要配置项（完整默认值见 [config.js](../packages/core/config.js)）：

| 配置项 | 说明 |
|--------|------|
| `wsPort` / `token` | OneBot 反向 WS 端口（默认 8080）与 NapCat 鉴权 token |
| `napcatHttpHost` | NapCat HTTP API 地址（默认 `127.0.0.1:3000`，取图片等走这里） |
| `owner` / `selfId` | 管理员 ID / 机器人 QQ 号 |
| `targetGroupId` / `targetUserId` | 目标群 / 用户白名单（管理员在目标会话发 `#bind` 可自动加入） |
| `llmApiUrl` / `aiApiKey` / `chatModel` | 文本模型端点、密钥与模型名（OpenAI 兼容） |
| `visionApiKey` / `visionModel` | 识图模型（缺省回落文本模型配置） |
| `enableLongTermMemory` / `memoryMaxRecords` | 长期记忆开关（默认开）与容量上限（默认 2000） |
| `memoryEmbedProvider` / `memoryEmbedModel` | embedding 提供方（`ollama` 本地 / `openai` 兼容）与模型 |
| `web` | 面板 API：`port`（2145）/ `path` / `token` / `logBufferSize` |
| `desktopPort` | 桌面客户端 WS 端口（默认 2147，token 与 NapCat 共用） |
| `shellGate` / `guard*` | `run_shell` 门禁模式（`guard` / `open`）与 guard 模型端点 |
| `mcpServers` | MCP Server 列表（默认自带无需凭据的 `websearch`；当前运行时已解耦未接入，仅保留配置项） |
