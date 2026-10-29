# Cith

<div align="center">

[![GitHub Stars](https://img.shields.io/github/stars/chail233/Cith?style=flat-square&logo=github&color=gold)](https://github.com/chail233/Cith/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/chail233/Cith?style=flat-square&logo=github)](https://github.com/chail233/Cith/forks)
[![GitHub Issues](https://img.shields.io/github/issues/chail233/Cith?style=flat-square&logo=github)](https://github.com/chail233/Cith/issues)
[![License](https://img.shields.io/github/license/chail233/Cith?style=flat-square)](https://github.com/chail233/Cith/blob/master/LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![OneBot](https://img.shields.io/badge/OneBot-v11-black?style=flat-square)](https://github.com/botuniverse/onebot-11)
[![WeChat](https://img.shields.io/badge/WeChat-iLink_Bot-07C160?style=flat-square&logo=wechat&logoColor=white)](https://www.npmjs.com/package/@wechatbot/wechatbot)

</div>

**Cith** 是一个开源的**个人 Agent**：跑在你自己的设备上，住在你已有的聊天软件里（QQ / 微信），7×24 小时在线帮你办事。它不是又一个聊天机器人，而是一个真正能做事的 AI：

- **住在聊天软件里** —— QQ、微信哪个常用住哪个，私聊群聊都行，像一位普通联系人一样对话
- **真正能做事** —— 多轮推理中自主调用工具：读写文件、隔离子进程执行脚本、动态接入 MCP 工具，把一句需求变成一件办完的事
- **持久记忆** —— 四层记忆 + 用户画像，记得你的一切，越用越懂你，成为独一无二的你的 AI
- **技能生态** —— `SKILL.md` 驱动的技能系统，支持从 GitHub 安装社区技能，它甚至可以自己给自己装技能
- **自主苏醒** —— 会给自己设闹钟，到点主动干活；群里冷场时也会判断要不要搭话
- **默认自持** —— 部署在自己的机器上，OpenAI 标准协议接入任意模型端点；文件操作有白名单门禁与目录穿越硬拦截

## 快速开始

### 环境要求

- Node.js >= 24（`npm start` 依赖 Node 原生 type stripping 直接运行 `.ts`；WeChat SDK 要求 >= 22）
- QQ 接入：NapCat 客户端已运行并配置好反向 WebSocket（仅运行微信适配器则不需要）

### 安装与启动

```bash
git clone https://github.com/chail233/Cith
cd Cith
npm install
npm start
```

NapCat 反向 WebSocket 连接地址：`ws://127.0.0.1:8080/onebot/v11/ws`（端口随 `wsPort` 变化）。

**npm 脚本：**

| 命令 | 说明 |
|------|------|
| `npm start` | 直接运行 `core/` 源码（开发推荐，改完即生效） |
| `npm run build` | tsc 编译 `core/` → `dist/`，并拷贝 SKILL.md 等非代码资源 |
| `npm run build:watch` | watch 模式构建（资源拷贝不会自动重跑，需手动 build） |
| `npm run start:dist` | 运行构建产物 `dist/index.js`（上线部署用） |

> `start` 与 `start:dist` 行为完全一致，差异仅在运行方式：`start` 依赖 Node 24 现场转译 TS，`start:dist` 跑预编译纯 JS、启动更快，但需先 `npm run build`。`dist/` 不提交 git。

### 配置

所有配置集中在 `core/config.js`：

- **开发环境**：`DevMode` 设为 `true`，在 `core/configDev.js`（已 gitignore）中填写真实配置；`DevMode` 为 true 但文件缺失时进程直接退出。
- **生产环境**：`DevMode` 设为 `false`，直接在 `config.js` 中填写。
- **运行期持久化**：`config` 由 Proxy 包裹，运行期的顶层键赋值（`#ms` 切模型、面板 `set_config` 等）自动写入 `core/configOverride.json`，重启后叠加生效（`members` / `mcpServers` / `DevMode` 不落盘）。

主要配置项：

| 配置项 | 说明 |
|--------|------|
| `wsPort` | OneBot 反向 WebSocket 服务端口（默认 8080） |
| `token` | OneBot 鉴权 Token |
| `napcatHttpHost` | NapCat HTTP API 地址（默认 `127.0.0.1:3000`，图片获取等走 HTTP） |
| `owner` | 主人（管理员）用户 ID |
| `targetGroupId` / `targetUserId` | 目标群 / 用户 ID 列表（微信 ID 形如 `xxx@im.wechat`，从日志复制） |
| `selfId` | 机器人 QQ 号 |
| `aiAPIKEY` / `visionAPIKEY` | 文本模型（含长期记忆）与视觉模型 API Key |
| `CHAT_MODEL` / `VISION_MODEL` | 聊天 / 识图模型名称 |
| `LLM_API_URL` | LLM API 地址（OpenAI 兼容协议） |
| `ENABLE_LONG_TERM_MEMORY` | 是否启用云端长期记忆与用户画像（默认 false） |
| `mcpServers` | MCP Server 配置列表 |
| `readFileDirs` / `runJsDirs` / `editFileDirs` | 文件工具白名单目录（默认 `skills/`、`workspace/`） |
| `web` | 面板 API 服务：`port` / `path` / `token` / `logBufferSize` |
| `githubToken` | GitHub API Token（skill-manager 安装技能、GitHub MCP 使用） |
| `EnableProactiveChat` / `PROACTIVE_CHAT_LIMIT` | 主动聊天开关与触发阈值（默认 15 条） |
| `toolOutput` | 是否在群里播报工具调用（默认 false） |
| `members` | QQ 号 → 群昵称映射表 |

---

## 核心能力

### 自主 Agent 循环

AI 运行在一个多轮工具调用循环中：接收消息 → 推理 → 调用工具（同轮多个调用并行执行）→ 观察结果 → 继续推理 → 输出回复，最多 30 轮（`TOOLCHAIN_MAX_LENGTH` 可配置）。单个工具失败不中断循环，错误原因回写为工具结果，交给模型自我修正。工具调用痕迹以 `system` 消息回填会话记忆，兼容只接受 system/user/assistant 的消息接口。

循环中 AI 可通过 `manage_plan` 维护一份**会话任务计划**（总体目标 + 带状态的步骤清单），每轮自动回注上下文，长链条任务不丢目标，用户可用 `#plan` 查看。

Agent 本身不持有任何聊天通道，所有输出以事件广播；同一会话同时只允许一个模型请求，避免并发回复串台。

### 四层记忆系统

从短期到长期的完整记忆架构，在上下文窗口限制与信息保留之间取得平衡：

| 层级 | 存储位置 | 容量/周期 | 触发条件 |
|------|---------|-----------|----------|
| 短期记忆 | 内存 | 最近 40 条（可配） | 每次对话实时更新 |
| 中期缓存 | 内存 | 满 40 条触发概括 | 短期溢出时 |
| 中期概括 | 内存 | 每次概括覆盖 | 每次对话开工时检查 |
| 长期记忆 | 阿里云百炼记忆库 | 无上限 | 旧概括被替换时存入；AI 通过 `get_memory` 自主检索 |

长期记忆由 `ENABLE_LONG_TERM_MEMORY` 控制，**默认关闭**；开启需配置 `MEMORY_API_BASE_URL` 与 `MEMORY_PROFILE_SCHEMA_ID`。

记忆按会话隔离（`AgentManager` 会话池懒创建）：空闲 30 分钟自动回收（回收前压缩归档），会话数超上限（50）时按最久未活跃淘汰。可用 `#sessions` 查看各会话记忆状态。

### 工具调用（Function Calling）

AI 可自主判断并调用以下工具，所有文件操作都受**路径白名单**和**目录穿越防护**约束：

| 工具 | 功能 |
|------|------|
| `get_memory` | 语义检索长期记忆 |
| `get_user_profile` | 获取指定用户的画像信息 |
| `read_file` / `list_files` | 读取白名单目录下的文件 / 列出目录内容 |
| `run_JS` | 在隔离子进程中执行 JS 脚本 |
| `create_file` / `edit_file` / `delete_file` | 创建（禁止覆盖）/ 搜索替换编辑 / 删除文件 |
| `list_mcp_tools` | 动态加载 MCP Server 的工具 |
| `manage_plan` | 创建/更新当前会话的任务计划 |
| `schedule` | 给自己设定时任务，到点自动苏醒 |
| `get_stickers` | 按标签检索表情包并发送 |

**文件操作安全门禁**按执行对象所在目录判定而非按工具名一刀切：白名单目录内直接放行不打扰管理员；白名单外挂起待确认（生成编号 `#xxxx`，管理员 `#do-yes` / `#do-no` 处置，10 分钟超时作废）；`../` 目录穿越无论如何被硬拦截。

### Skill 技能系统

Skill 是包含 `SKILL.md` 描述文件的目录，可附带脚本供 AI 执行。frontmatter 元数据（`name`、`description`、可选 `force`）决定加载方式：

- **普通技能**：仅将 `name` + `description` 注入技能列表，AI 判断相关时再按需读取正文，节省 token。
- **强加载技能（`force: true`）**：正文固定注入每次对话的 system prompt，确保关键技能 100% 可达。

每次对话开工前重新扫描 `skills/` 目录，技能增删改下一条消息即生效。内置 `skill-manager` 支持从 GitHub 安装/卸载技能、设置强加载（需管理员确认）——技能可被社区开发共享，AI 甚至可以自主安装新技能扩展自身能力。

### MCP 工具扩展

支持连接外部 MCP Server（**stdio** 本地子进程 / **old_sse** 旧版 SSE / **sse** 新版 Streamable HTTP），为 AI 提供几乎无限的工具扩展。MCP 工具不一次性塞进上下文：AI 先调用 `list_mcp_tools` 按需加载某个 Server 的工具定义，再以返回的带服务器命名空间的名称调用。旧的 `mcp_<原工具名>` 仅在工具名唯一时可用。`mcp/github-server` 是一个现成的 GitHub MCP Server 示例。

### 特色行为

- **视觉能力**：群内图片自动调用视觉模型识别内容并注入上下文，让 AI 能"看到"图片（独立 `VISION_MODEL` / `visionAPIKEY` 配置）。
- **主动聊天**：群内连续多条消息没有 @机器人时（达 `PROACTIVE_CHAT_LIMIT`），AI 带完整上下文被唤醒，自主判断是否参与对话。`#pchat` 可开关。
- **复读**：检测到连续重复消息时跟随复读一次，并把该文本拉黑防止无限复读。
- **定时任务**：AI 可通过 `schedule` 工具"给自己设闹钟"（一次性 / 固定间隔 / 每日定点 / cron），到点触发完整 Agent 苏醒流程。任务持久化到 `data/schedule.json`，重启不丢失，停机期间错过的触发按追赶策略处理。
- **表情包**：内置表情包库（`manifest.json` 描述画面与标签），AI 按标签检索表情让回复更生动。
- **用户画像**：自动从对话中提取用户特征存入云端画像模板，AI 可查询指定用户的画像实现个性化回应（依赖长期记忆开关）。

### 多平台接入

| 平台 | 适配器 | 说明 |
|------|--------|------|
| QQ | `OnebotAdapter` + `OnebotServer` | NapCat + OneBot v11，反向 WebSocket 接入 |
| 微信 | `WechatBotAdapter` + `WechatBotServer` | 官方 iLink Bot 协议，扫码登录，凭证持久化重启复用 |

微信侧为协议层约束的已知限制：好友首次发消息后需从日志复制其加密 `userId` 加入 `targetUserId` 白名单；拿不到昵称/头像；仅文本消息、仅私聊；只能回复主动发过消息的用户。

### Web 管理面板

```
浏览器（React 18 + Vite，:5173 开发 / :2146 生产）
   │  HTTP(S) /api/rpc · SSE /api/events
   ▼
面板 BFF（web/server，Express 5，:2146，http 或 https 自签名）← 面板 token 只保存在这里
   │  WebSocket（协议见 web/bot-api-integration.md）
   ▼
Bot 面板 API 服务（core/api/，仅绑定 127.0.0.1）
```

Bot 侧 API 内嵌于 Bot 主进程：独立 token 鉴权（5s 握手超时）、action 白名单分发、配置输出脱敏（密钥不外泄）、30s 心跳回收死连接、日志/事件进环形缓冲支持断线补拉。BFF 持有常驻 WS 客户端（自动鉴权、指数退避重连），对浏览器暴露统一 RPC 与 SSE 事件流，action 转发同样有白名单门禁，生产模式下单进程托管前端构建产物。

| 页面 | 功能 |
|------|------|
| 运行状态 | 运行时长 / OneBot 在线 / MCP 连接数 / 内存 / Node 版本 + 最近事件速览 |
| 配置管理 | 脱敏快照查看；白名单字段可热改，拒绝原因原样展示 |
| 事件日志 | SSE 实时事件流 + 断线按 Last-Event-ID 自动续传，级别/类型筛选与搜索 |
| 能力清单 | 动态展示 Bot 支持的 action 及说明 |

**用法：**

```bash
# 开发模式（两个终端）
cd web && npm install
npm run server   # 终端 1：BFF，http://127.0.0.1:2146
npm run dev      # 终端 2：Vite，http://localhost:5173

# 生产模式（单进程，BFF 同时托管 dist/ 页面）
cd web && npm run build && npm run server
```

环境变量（复制 `web/.env.example` 为 `web/.env`）：`WEB_PORT`（默认 2146）、`BOT_API_URL`（默认 `ws://127.0.0.1:2145/api/v1/ws`）、`BOT_API_TOKEN`（与 Bot `config.web.token` 一致）、`WEB_PASSWORD`（设置后打开面板需先登录）、`WEB_SSL_ENABLED`（设为 `true` 时 BFF 以自签名证书提供 https，无域名也能 HTTPS 访问）、`WEB_SERVER_IP`（写入证书 SAN 的公网 IP，留空则仅含 `localhost`/`127.0.0.1`）。

> ⚠️ 生产部署务必修改 `BOT_API_TOKEN` 并设置 `WEB_PASSWORD`；BFF 与 Bot API 仅应暴露在本机或可信内网。启用 HTTPS 后证书自动生成并落盘到 `web/.ssl/`（10 年有效期，重启复用同一证书，浏览器信任一次即可），首次访问会出现自签名证书安全警告，属预期行为。

详细文档见 [web/README.md](web/README.md)。

---

## 架构

### 事件处理管道

```
QQ：NapCat 发送事件                     WeChat：iLink 长轮询收到消息
    │                                       │
    ▼                                       ▼
bot/servers/OnebotServer.js            bot/servers/WechatBotServer.ts
（反向 WebSocket 服务）                  （扫码登录 / 会话管理）
    │                                       │
    ▼                                       ▼
bot/adapters/OnebotAdapter             bot/adapters/WechatBotAdapter
（OneBot v11 协议解析）                  （归一化为 CtxEvent）
    └──────────────────┬────────────────────┘
                       ▼
        pipeline/context.ts 构建 Context → pipeline/index.js 管道编排
    │  （仅 targetGroupId / targetUserId 命中的消息继续）
    │
    ├─ 中间件（全部执行，丰富上下文）
    │   ├─ image-recognizer  → 识别图片 → ctx.imageDescription
    │   ├─ at-detector       → 解析 @ 对象 → ctx.at（@bot 时为"我"）
    │   └─ mini-program      → 处理小程序/链接分享
    │
    └─ 处理器（首个返回 true 即停止）
        ├─ user-commands     → # 前缀命令（#help、#plan 等）
        ├─ ai-chat           → @机器人（或私聊）时触发 Agent 循环
        ├─ repeater          → 复读检测
        └─ proactive-chat    → 记录上下文，达阈值时主动聊天
```

### Agent 对话流程

核心原则：**Agent 只负责"想"，不负责"说"**。

```
用户消息触发对话（pipeline/agent-runner.ts：runAgent）
    │  临时挂上 reply / tool-call 事件监听 → run → 分发链落定后摘监听
    ▼
Agent.run()（core/agent/Agent.ts，每会话一实例，AgentManager 池管理）
    │  开工前：触发中期概括 → 重新扫描 skills 目录
    ▼
组装上下文（系统提示 + 强加载技能 + 技能/MCP 列表 + 记忆概要 + 活跃计划 + 历史）
    ▼
调用 LLM（携带全部工具定义）
    ├─ 无工具调用 → 解析 JSON 回复 → 广播 "reply" 事件 → 写入会话记忆
    └─ 有工具调用 → 并行执行 → 结果回填记忆 → 再次请求（最多 30 轮）
        ├─ 本地工具 → 路径穿越防护 + 白名单门禁
        └─ MCP 工具 → 路由到对应 MCP Server
    ▼
事件消费方（agent-runner）通过适配器发送消息（分段、拟人化节流）
```

Agent 不持有任何聊天通道，所有输出以事件广播——换协议、加 Web 端可视化、接日志回放，只需再写一个监听者，不动 AI 核心。

### 用户命令

`#` 前缀触发，管理员 = `config.owner`：

| 命令 | 权限 | 说明 |
|------|------|------|
| `#help` / `#skills` / `#forceskills` | 所有人 | 指令列表 / 技能列表 / 强加载技能 |
| `#plan` / `#mcp` / `#tools` | 所有人 | 任务计划 / MCP 连接 / 可用工具 |
| `#msgs` / `#cmsgs` / `#sm` | 管理员 | 短期记忆 / 缓存记录 / 中期概括 |
| `#clear` / `#compress` | 管理员 | 清除 / 压缩短期记忆 |
| `#sessions` | 管理员 | 列出活跃会话（记忆条数/概要/空闲时长） |
| `#ms <模型>` | 管理员 | 切换聊天模型 |
| `#pchat <bool>` / `#toolout <bool>` | 管理员 | 开关主动聊天 / 工具调用播报 |
| `#do-yes <id>` / `#do-no <id>` / `#do-pending` | 管理员 | 确认 / 取消 / 列出待确认操作 |

---

## 项目结构

```
core/
├── index.js                    # 入口：初始化 MCP → 启动 WS 服务（QQ/微信）→ 启动面板 API
├── config.js                   # 统一配置，Proxy 自动持久化
├── configDev.js                # 开发环境配置（gitignore，覆盖 config.js）
│
├── bot/                        # 通信层：servers（连接/生命周期）+ adapters（协议适配，可插拔）
│   ├── servers/                # OnebotServer（QQ 反向 WS）/ WechatBotServer（扫码登录）
│   └── adapters/               # BaseAdapter 抽象基类 + Onebot / WechatBot 实现
│
├── pipeline/                   # 事件处理管道
│   ├── index.js                # 管道编排：中间件 → 处理器
│   ├── context.ts              # 上下文构建与目标过滤
│   ├── agent-runner.ts         # Agent 事件 → 适配器分发（节流发送）
│   ├── middleware/             # image-recognizer / at-detector / mini-program
│   └── handlers/               # user-commands / ai-chat / repeater / proactive-chat
│
├── agent/                      # Agent 核心（AI 相关代码全部内聚于此）
│   ├── Agent.ts                # 循环主体 + 会话任务计划，只产出事件不碰通道
│   ├── AgentManager.ts         # 会话池：空闲回收 / 数量上限
│   ├── contextBuilder.ts       # LLM 请求上下文组装
│   ├── replyParser.ts          # 模型回复解析（{action:[...]}）
│   ├── client.js               # LLM API 客户端（文本 / 视觉）
│   ├── tools.js                # 工具定义、调度与路径门禁
│   ├── tools/                  # 细粒度工具模块（一个工具一个文件）
│   ├── tool-approval.js        # 危险操作确认队列
│   ├── approval-runner.ts      # 危险操作确认执行链
│   ├── mcp-client.js           # MCP 客户端管理器
│   ├── skill.js                # Skill 加载器
│   ├── image.js                # 视觉 API
│   ├── long-term-memory.js     # 长期记忆 + 用户画像 API
│   └── recorder.js             # 三层记忆记录器（短期/缓存/概括）
│
├── api/                        # Web 面板 API（独立 WS 服务端：鉴权/心跳/白名单/事件总线）
├── services/                   # 适配器注册表 / NapCat HTTP / 复读队列 / 定时调度 / 苏醒触发
├── stickers/                   # 表情包库（index.js 按标签检索 + manifest.json + images/）
├── types/                      # 跨模块共用类型（Context / CtxEvent / Space 等）
├── skills/                     # Skill 技能目录（AI 可读写，内置 skill-manager）
├── workspace/                  # 工作区（AI 可读写）
└── utils/                      # logger / file-security（路径防护）/ extractText 等

scripts/copy-assets.js          # 构建后将 skills/workspace 的非代码资源拷贝到 dist
web/                            # Web 管理面板（独立 npm 工程，详见 web/README.md）
mcp/                            # 本地 MCP Server（gitignore；mcp/github-server 为示例）
```

根目录：`tsconfig.json` 为 IDE 类型检查基准（strict + noEmit）；`tsconfig.build.json` 为构建配置（noCheck 只转译）。

---

## 开发指南

### 添加关键词命令

在 `pipeline/handlers/keyword-commands.js` 的 `CMD_MAP` 中添加（框架保留，当前为空）：

```js
CMD_MAP.set("关键词", async (ctx) => {
    ctx.adapter.sendMsg(ctx.space, "回复内容");
});
```

### 添加用户命令

在 `pipeline/handlers/user-commands.js` 的 `cmds` 数组中添加：

```js
{
    name: "命令名",
    description: "命令描述",
    needsAdmin: true,          // 可选，默认 false
    params: [{ name: "参数名", desc: "参数说明" }],
    handler: async (args, ctx) => {
        return "回复文本";
    }
}
```

### 添加新工具

在 `agent/tools.js` 的 `tools` 数组中添加定义，并在 `toolMap` 中注册处理函数，新工具会自动出现在 AI 的可用工具列表中。带文件路径参数的工具还须在 `pathToolWhitelist` 中登记 `{ dirKey, pathKey }`，门禁才会按执行对象目录自动放行或挂起。

### 添加 MCP Server

在 `configDev.js` 的 `mcpServers` 中添加：

```js
{
    name: "github",
    description: "GitHub 操作",
    transport: "stdio",        // 或 "sse" / "old_sse"
    command: "node",
    args: ["D:/path/to/mcp/github-server/index.js"],
}
```

### Skill 开发

1. 在 `core/skills/` 下创建目录与 `SKILL.md`（frontmatter：`name`、`description`，可选 `force: true` 使正文固定注入上下文）
2. 在 `scripts/` 子目录中编写 JS 脚本：通过 `process.argv[2]` 接收 JSON 参数，`console.log()` 输出结果；脚本在子进程中执行，30 秒超时

### TypeScript 开发约定

项目为 JS 为主、逐步引入 TS 的混合结构，依赖 Node 24 原生 type stripping 直接运行 `.ts`：

- JS 文件引用 TS 模块时，import 路径**显式写 `.ts` 后缀**；构建时 tsc 自动重写为 `.js`（`rewriteRelativeImportExtensions`）
- 导入 interface **必须用 `import type`**；JS 文件中引用类型用 JSDoc：`/** @typedef {import("./xxx.ts").Type} Type */`
- `.ts` 中只允许"可擦除语法"（禁用 `enum` 等，由 `erasableSyntaxOnly` 约束）
- 类型检查由 IDE 实时提供（strict 模式）；构建走 `noCheck` 只转译，不提供 CLI 检查

### 安全设计

- **目录穿越防护**：`..` 等越出 `core/` 的路径被 `file-security.js` 硬拦截，是不可绕过的安全底线
- **白名单门禁**：文件类工具按执行对象目录判定——白名单内直接放行，目录外挂起待管理员确认
- **子进程隔离**：JS 脚本在独立子进程中执行，带超时限制
- **写入保护**：`create_file` 禁止覆盖已有文件，`edit_file` 要求文本唯一匹配
- **面板 API**：仅绑定 `127.0.0.1`、独立 token 鉴权、action 白名单分发、配置输出脱敏、全量 try/catch 故障隔离

---

## License

[MIT](LICENSE)
