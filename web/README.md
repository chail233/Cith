# SunbatwoBot Web 面板

Bot 的 Web 管理面板：React 18 + TypeScript + Vite 前端 + 轻量 Node BFF（Express + ws）。

## 架构

```
浏览器 (React, :5173 dev / :2146 prod)
   │  HTTP(S): /api/rpc、/api/health、/api/login   SSE: /api/events
   ▼
BFF (web/server, :2146, http 或 https 自签名)  ← token(BOT_API_TOKEN) 只保存在这里
   │  WebSocket（bot-api-integration.md 定义的协议）
   ▼
Bot 面板 API Server (core/api/server.ts, ws://127.0.0.1:2145/api/v1/ws)
```

设计要点（与 `bot-api-integration.md` 对齐）：

- **浏览器不直连 Bot**：面板 token 只存在于 BFF 进程；浏览器与 BFF 之间用密码会话（可选）。
- **请求-响应按 id 关联**：BFF 的 `BotApiClient` 为每个请求生成唯一 id，超时 10s 清理；非法 JSON 的空 id error 帧按无主帧丢弃。
- **断线自动重连 + 补拉**：
  - BFF ↔ Bot：指数退避重连（1s 起，封顶 15s），鉴权成功后用 `lastTs` 调 `get_logs({ since })` 从环形缓冲补拉；
  - 浏览器 ↔ BFF：SSE（`EventSource` 自带重连），重连时自动携带 `Last-Event-ID`，BFF 据此补拉；前后帧按 `ts+event+data` 去重。
- **未知兼容**：未知 action / 未知事件名均不抛错（前端 JSON 透传展示，BFF 白名单拒绝转发）。

## 快速开始

```powershell
cd web
npm install

# 终端 1：启动 BFF
npm run server          # http://127.0.0.1:2146

# 终端 2：启动前端（开发模式）
npm run dev             # http://localhost:5173，/api 自动代理到 BFF
```

生产模式：`npm run build` 后只需 `npm run server`（BFF 托管 `dist/` 静态资源，单进程运行）。

### 环境变量（复制 `.env.example` 为 `.env`，`npm run server` 会自动加载）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WEB_PORT` | `2146` | BFF 监听端口 |
| `BOT_API_URL` | `ws://127.0.0.1:2145/api/v1/ws` | Bot 面板 API 地址 |
| `BOT_API_TOKEN` | `114514` | 与 Bot `config.web.token` 一致 |
| `WEB_PASSWORD` | 未设置 | 浏览器登录密码；设置后打开面板需先登录 |
| `WEB_SSL_ENABLED` | `false` | 设为 `true` 时 BFF 以自签名证书提供 https（无域名也能 HTTPS 访问） |
| `WEB_SERVER_IP` | 未设置 | 写入证书 SAN 的公网 IP（留空则仅含 `localhost`/`127.0.0.1`） |

> 生产部署务必修改 `BOT_API_TOKEN` 并设置 `WEB_PASSWORD`。

### HTTPS 自签名证书

无域名场景下设置 `WEB_SSL_ENABLED=true` 即可通过 `https://<IP>:<WEB_PORT>` 访问面板：

- 证书在 BFF 启动时自动生成（selfsigned，RSA 2048，有效期 10 年）并落盘到 `web/.ssl/`（已 gitignore）；重启复用同一证书，浏览器**信任一次即可长期使用**，不会每次重启都重新提示；
- 删除 `web/.ssl/` 下的 `key.pem` / `cert.pem` 即可在下次启动时重新生成（例如服务器 IP 变更后需带上新的 `WEB_SERVER_IP` 重新生成）；
- 自签名证书浏览器首次访问会有安全警告，点击「继续访问」/信任证书后一切正常（含 SSE 事件流）；
- 依赖 `selfsigned` v5+（`generate` 为异步 API，有效期通过 `notAfterDate` 指定）。

## 功能页面

| 页面 | 数据来源 | 说明 |
|------|----------|------|
| 运行状态 | `get_status`（5s 轮询） | 运行时长 / OneBot 在线 / MCP 连接数 / 内存 / Node 版本 + 最近事件速览 |
| 配置管理 | `get_config` / `set_config` | 脱敏快照展示；非脱敏字段可尝试热改，白名单由 Bot 控制，拒绝原因原样展示 |
| 事件日志 | `log` 事件流 + `get_logs` | 级别筛选 / 事件类型筛选 / 内容搜索 / 自动滚动；进入页面自动补拉最近 200 条 |
| 能力清单 | `list_actions`（30s 轮询） | 动态展示 Bot 支持的 action 及说明 |

顶栏三个状态灯：**BFF**（HTTP 可达）、**Bot**（WS 已鉴权）、**事件流**（SSE 已连接）。

## 目录结构

```
web/
├── server/              # BFF（Node + Express + ws）
│   ├── bot-client.mjs   #   BotApiClient：鉴权、id 关联、重连、补拉
│   └── index.mjs        #   HTTP 路由：rpc / events(SSE) / health / login / 静态托管
├── src/
│   ├── api/client.ts    # BFF HTTP 客户端（会话 token 管理、RPC 封装）
│   ├── hooks/
│   │   ├── event-stream.tsx  # 全局 SSE 事件流 Provider（去重 / 排序 / 补拉灌入）
│   │   └── usePolling.ts     # 轮询 hook（后台标签页暂停）
│   ├── components/      # 通用 UI（卡片 / 徽标 / 状态灯 / 登录页等）
│   ├── pages/           # 四个功能页面
│   ├── types.ts         # 协议与领域类型（对应 core/api/types.ts）
│   ├── utils/format.ts  # 展示格式化
│   └── App.tsx          # 布局 + hash 路由
├── bot-api-integration.md  # Bot 端协议文档（对接依据，勿随意修改）
└── README.md            # 本文档
```

## BFF HTTP 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/login` | `{password}` → `{token}`（未设 `WEB_PASSWORD` 时返回 `required:false`） |
| GET | `/api/session` | `{required, authed}` 会话探测 |
| GET | `/api/health` | BFF / Bot 连接状态、最近事件时间戳 |
| POST | `/api/rpc` | `{action, params}` → Bot 响应；action 仅限白名单（get_status / get_config / set_config / get_logs / list_actions） |
| GET | `/api/events` | SSE 事件流；`id` 即事件 ts，支持 `Last-Event-ID` 补拉；15s 心跳注释帧 |

错误约定：白名单外 action → HTTP 403；Bot 未连接 → HTTP 503；Bot 业务错误（如 set_config 拒绝）→ HTTP 200 + `{status:"error", message}`，便于前端区分展示。

## 协议实现细节备忘

- **auth 握手**：连接建立后立即发送 `{id, action:"auth", token}`（token 是顶层字段而非 params），5 秒内完成；Bot 关闭码 `4001`=鉴权超时、`4401`=token 错误，BFF 日志会明确提示。
- **帧分流**：`type === "event"` → 事件帧（更新 lastTs 并分发）；否则按 `id` 结算挂起请求，`status:"error"` 转 reject。
- **保活**：`ws` 客户端自动回复 Bot 的 ping，无需手动处理。
- **环形缓冲**：Bot 端默认 1000 条（`web.logBufferSize`），`since` 过早时最多只能补回缓冲内的数据。

## 常见问题

- **顶栏 Bot 灯一直是红的**：确认 Bot 主进程已启动且 `core/config.js` 的 `web.port` 与 BFF 的 `BOT_API_URL` 端口一致；查看 BFF 终端日志，若出现 `4401` 说明 token 不匹配。
- **配置编辑保存报「该配置项不允许修改」**：Bot 端白名单（`core/api/actions/config.ts` 的 `WRITABLE_KEYS`）未包含该字段，属预期行为。
- **日志页看不到更早的历史**：受 Bot 环形缓冲容量限制，超出部分已被覆盖。
- **浏览器访问 HTTPS 面板提示证书不受信任**：自签名证书的预期行为，信任后即可；若信任后仍提示，多半是服务器 IP 变了而证书 SAN 还是旧 IP——更新 `WEB_SERVER_IP` 并删除 `web/.ssl/` 后重启重新生成。
