# Cith Web 管理面板

Cith 的 Web 管理面板：React 18 + TypeScript + Vite 前端 + 轻量 Node BFF（Express + ws）。

## 架构

```
浏览器 (React, :5173 dev / :2146 prod)
   │  HTTP(S): /api/rpc、/api/health、/api/login   SSE: /api/events
   ▼
BFF (web/server, :2146, http 或 https 自签名)  ← token(BOT_API_TOKEN) 只保存在这里
   │  WebSocket（协议帧形状见 packages/core/api/types.ts）
   ▼
Bot 面板 API Server (packages/core/api/server.ts, ws://127.0.0.1:2145/api/v1/ws)
```

设计要点：

- **浏览器不直连 Bot**：面板 token 只存在于 BFF 进程；浏览器与 BFF 之间用密码会话（可选）。
- **请求-响应按 id 关联**：BFF 的 `BotApiClient` 为每个请求生成唯一 id，超时 10s 清理；非法 JSON 的空 id error 帧按无主帧丢弃。
- **断线自动重连 + 补拉**：
  - BFF ↔ Bot：指数退避重连（1s 起，封顶 15s），鉴权成功后用 `lastTs` 调 `get_logs({ since })` 从环形缓冲补拉；
  - 浏览器 ↔ BFF：SSE（`EventSource` 自带重连），重连时自动携带 `Last-Event-ID`，BFF 据此补拉；前后帧按 `ts+event+data` 去重。
- **未知兼容**：未知 action / 未知事件名均不抛错（前端 JSON 透传展示，BFF 白名单拒绝转发）。

## 快速开始

```powershell
npm install             # 仓库根执行一次（workspaces 统一安装）
cd packages/web

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

## 功能页面

| 页面 | 数据来源 | 说明 |
|------|----------|------|
| 运行状态 | `get_status`（5s 轮询）+ `get_token_usage`（60s 轮询） | 运行时长 / OneBot 在线 / 内存 / Node 版本 + Token 用量与花销（今日 / 近 7 天 / 累计，含缓存命中率）+ 最近事件速览 |
| 模型价格 | `get_model_pricing` / `set_model_pricing` | 按模型填「元 / 百万 tokens」单价，保存即时生效；未定价模型一键补价 |
| 系统提示词 | `get_prompt` / `set_prompt` | 在线编辑 `packages/core/prompts/system.md`，保存带 `.bak` 备份，下一轮生效 |
| 配置管理 | `get_config` / `set_config` | 脱敏快照展示；非脱敏字段可尝试热改，白名单由 Bot 控制，拒绝原因原样展示 |
| 事件日志 | `log` 事件流 + `get_logs` | 级别筛选 / 事件类型筛选 / 内容搜索 / 自动滚动；进入页面自动补拉最近 200 条 |
| 能力清单 | `list_actions`（30s 轮询） | 动态展示 Bot 支持的 action 及说明 |

顶栏三个状态灯：**BFF**（HTTP 可达）、**Bot**（WS 已鉴权）、**事件流**（SSE 已连接）。

## 目录结构

```
packages/web/
├── server/              # BFF（Node + Express + ws）
│   ├── bot-client.mjs   #   BotApiClient：鉴权、id 关联、重连、补拉
│   └── index.mjs        #   HTTP 路由：rpc / events(SSE) / health / login / 静态托管
├── src/
│   ├── api/client.ts    # BFF HTTP 客户端（会话 token 管理、RPC 封装）
│   ├── hooks/
│   │   ├── event-stream.tsx  # 全局 SSE 事件流 Provider（去重 / 排序 / 补拉灌入）
│   │   └── usePolling.ts     # 轮询 hook（后台标签页暂停）
│   ├── components/      # 通用 UI（卡片 / 徽标 / 状态灯 / 登录页等）
│   ├── pages/           # 六个功能页面
│   ├── types.ts         # 协议与领域类型（对应 packages/core/api/types.ts）
│   ├── utils/format.ts  # 展示格式化
│   └── App.tsx          # 布局 + hash 路由
└── README.md            # 本文档
```

## BFF HTTP 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/login` | `{password}` → `{token}`（未设 `WEB_PASSWORD` 时返回 `required:false`） |
| GET | `/api/session` | `{required, authed}` 会话探测 |
| GET | `/api/health` | BFF / Bot 连接状态、最近事件时间戳 |
| POST | `/api/rpc` | `{action, params}` → Bot 响应；action 仅限白名单（get_status / get_config / set_config / get_prompt / set_prompt / get_logs / list_actions / get_token_usage / get_model_pricing / set_model_pricing） |
| GET | `/api/events` | SSE 事件流；`id` 即事件 ts，支持 `Last-Event-ID` 补拉；15s 心跳注释帧 |

