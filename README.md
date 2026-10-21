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

**Cith** 是一个聊天场景中的 **Agent**。两个设计目标定义了它：**接入任何聊天场景**，以及**像真正的同事一样既聊天又工作**。

前者由可插拔适配器架构兜底——`BaseAdapter` 抽象基类只约定 `onMessage` / `sendMsg` 契约，内置的 `OnebotAdapter`（NapCat + OneBot v11）接入 QQ，`WechatBotAdapter`（微信官方 iLink Bot 协议，扫码登录）接入微信个人号，换平台就是换适配器。后者由 Agent 循环驱动——它不是“一问一答”的聊天机器人，而是能在多轮推理中自主调用工具、读写文件、执行脚本、检索长期记忆，把一句需求变成一件办完的事。

AI 能力由阿里云百炼平台驱动（支持 DeepSeek / Qwen 等模型）。

## 核心能力

### 自主 Agent 循环

AI 不再只是"一问一答"。它运行在一个 **多轮工具调用循环** 中：接收消息 → 推理 → 调用工具（同轮多个调用并行执行）→ 观察结果 → 继续推理 → 输出回复。这个循环最多可执行 30 轮（`TOOLCHAIN_MAX_LENGTH` 可配置）。单个工具执行失败不会中断循环，错误原因会作为工具结果回写，交给模型自我修正。

工具调用过程与结果以 `system` 消息的形式回填到会话记忆，而不是依赖原生 `tool` 角色——这样既保留了完整的执行痕迹，也兼容只接受 system/user/assistant 的消息接口。

循环中 AI 还可通过 `manage_plan` 工具维护一份**会话任务计划**（总体目标 + 带状态的步骤清单）：计划每轮自动回注上下文，长链条任务中不丢目标，全部完成后自动停止注入。用户可用 `#plan` 随时查看。

Agent 本身不持有任何聊天通道，所有输出以事件广播；同一会话同时只允许一个模型请求（`tryBeginRequest`），避免并发回复串台。

### 四层记忆系统

AI 拥有从短期到长期的完整记忆架构，在上下文窗口限制与信息保留之间取得平衡：

```
短期记忆（_messages）
  │ 最近 40 条对话（CHAT_HISTORY_LIMIT），超出则挤入缓存
  ▼
中期缓存（_cache）
  │ 达到 40 条时标记待概括
  ▼
中期概括（_midSummary）
  │ 被新概括覆盖前，自动存入长期记忆（需开启长期记忆）
  ▼
长期记忆（阿里云百炼记忆库）
  │ AI 通过工具调用（get_memory）自主检索相关记忆
  ▼
拼入工具调用结果 → 供 LLM 参考
```

| 层级 | 存储位置 | 容量/周期 | 触发条件 |
|------|---------|-----------|----------|
| 短期记忆 | 内存 | 40 条（可配） | 每次对话实时更新 |
| 中期缓存 | 内存 | 满 40 条触发概括 | 短期溢出时 |
| 中期概括 | 内存 | 每次概括覆盖 | 每次对话开工时检查 |
| 长期记忆 | 云端记忆库 | 无上限 | 旧概括被替换时存入；AI 自主检索 |

长期记忆由 `ENABLE_LONG_TERM_MEMORY` 控制，**默认关闭**。关闭时 `get_memory` / `get_user_profile` 会返回空结果，画像提取也不会发起云端请求；开启后需要配置 `MEMORY_API_BASE_URL` 与 `MEMORY_PROFILE_SCHEMA_ID`。

记忆按会话隔离，挂在对应的 Agent 实例上（`AgentManager` 会话池懒创建）：空闲 30 分钟自动回收（每 5 分钟扫描一次），回收前先把记忆压缩归档；会话数超上限（50）时按最久未活跃淘汰。可用 `#sessions` 查看各会话记忆状态。

### 工具调用（Function Calling）

AI 可自主判断并调用以下工具：

| 工具 | 功能 |
|------|------|
| `get_memory` | 语义检索长期记忆 |
| `get_user_profile` | 获取指定用户的画像信息 |
| `read_file` | 读取白名单目录下的文件 |
| `run_JS` | 在隔离子进程中执行 JS 脚本 |
| `create_file` | 创建新文件（禁止覆盖） |
| `edit_file` | 通过搜索替换编辑文件 |
| `delete_file` | 删除文件 |
| `list_files` | 列出目录内容 |
| `list_mcp_tools` | 动态加载 MCP Server 的工具 |
| `manage_plan` | 创建/更新当前会话的任务计划（目标 + 步骤清单，空清单清空） |

所有文件操作都受到 **路径白名单** 和 **目录穿越防护** 的安全约束。

### 文件操作安全门禁

文件类工具（`read_file`、`list_files`、`run_JS`、`create_file`、`edit_file`、`delete_file`）以**执行对象所在目录**决定放行与否，而非按工具名一刀切：

- 操作对象位于对应白名单目录内（读→`readFileDirs`，执行→`runJsDirs`，增删改→`editFileDirs`，默认 `skills/`、`workspace/`）→ **直接放行**，不打扰管理员（跑 skill 脚本、写 workspace 不再被挡）。
- 操作对象在白名单之外 → **挂起待确认**，生成待确认编号：
  1. 群内通知：`操作对象不在白名单目录内，需要管理员确认。已登记为待确认操作 #xxxx`
  2. 管理员发送 `#do-yes xxxx` 确认后执行，或 `#do-no xxxx` 取消
  3. 待确认项 10 分钟超时自动作废；队列上限 20 条
- 管理员本人发起、或工具调用已确认时跳过门禁。
- `../` 等目录穿越无论如何都被 `file-security.js` 硬拦截（既不直接放行也不挂起）。

> MCP 工具没有本地路径目标，不在此文件门禁范围内，按需调用。

### 用户画像

系统自动从对话中提取用户特征（爱好、性格、偏好等），存储到云端画像模板。AI 可通过 `get_user_profile` 工具查询特定用户（QQ 号或微信加密 ID）的画像，实现个性化回应。该能力依赖长期记忆开关，需 `ENABLE_LONG_TERM_MEMORY: true` 才生效。

### MCP 工具扩展

支持连接外部 MCP（Model Context Protocol）Server，三种传输协议：

- **stdio**：本地子进程
- **old_sse**：旧版 SSE 协议
- **sse**：新版 Streamable HTTP 协议

通过 MCP，AI 可以获得几乎无限的工具扩展能力。你可以在配置中添加任意 MCP Server 来为 AI 增加新工具。

MCP 工具不会一次性全部塞进上下文：AI 先调用 `list_mcp_tools` 加载某个 Server 的工具定义（仅生效一次），再以 `mcp_<原工具名>` 的形式调用。本地 `mcp/github-server` 是一个现成的 GitHub MCP Server 示例（`mcp/` 在 `.gitignore` 中）。

### Skill 技能系统

Skill 是包含 `SKILL.md` 描述文件的目录，可包含脚本供 AI 调用。AI 通过读取 SKILL.md 了解技能用法，通过 `run_JS` 执行技能脚本。

`SKILL.md` 的 frontmatter 元数据包含 `name`、`description`，以及可选的 `force`（布尔值）：

- **普通技能**：仅将 `name` + `description` 注入系统提示（技能列表），AI 判断相关时再用 `read_file` 按需读取正文，节省 token。
- **强加载技能（`force: true`）**：其 `SKILL.md` 正文（去除 frontmatter 后）会**固定注入每次对话的 system prompt**，确保关键技能 100% 可达、无需额外工具调用。

**每回合现取：** 每次 Agent 对话开工前都会重新扫描 `skills/` 目录，新增/删除/修改技能后下一条消息即生效，通常无需手动重载。

**内置技能：**

- `skill-manager`：管理技能全生命周期，支持从 GitHub 安装（`install`）、卸载（`uninstall`）、设置强加载（`set-force`）与取消强加载（`unset-force`）。安装/卸载前需要管理员确认。

技能可被社区开发和共享，AI 甚至可以自主安装新技能来扩展自身能力。

### 视觉能力

AI 具备图片识别能力。当群内发送图片时，自动调用视觉模型（Qwen）识别图片内容，将描述注入对话上下文，让 AI 能够"看到"并理解图片。视觉请求走独立的 `VISION_MODEL` / `visionAPIKEY` 配置。

### 主动聊天

当群内连续多条消息没有 @机器人时（计数达到 `PROACTIVE_CHAT_LIMIT`，默认 15），AI 会带着完整上下文被唤醒，根据情境判断是否主动参与对话（返回空 action 即保持沉默），行为更自然。可用 `#pchat <bool>` 开关。

### 复读

`repeater` 处理器会检测连续重复的消息（队列长度 `REPEATER_QUEUE_SIZE`，默认 10）：命中后机器人跟随复读一次，并把该文本拉黑，直到它被挤出队列，避免无限复读。

### WeChat 接入（iLink Bot）

通过 `WechatBotAdapter` + `WechatBotServer` 接入微信个人号，走官方 iLink Bot 协议（`@wechatbot/wechatbot` SDK），与 QQ 适配器共用同一条处理管道：

- **扫码登录**：首次登录在 `bot.login({ callbacks })` 的 `onQrUrl` 中输出二维码链接（协议只给 URL，渲染二维码是接入方职责）；登录凭证持久化到 `~/.wechatbot`，重启自动复用。
- **会话过期**：token 无固定有效期、协议不返回 TTL，仅在接口报 `errcode=-14` 时被动发现。SDK 会自动重新发起扫码登录，但该路径不带自定义回调，因此通过传入自定义 `logger` 截获 SDK 内部日志中的新二维码链接，配合 `session:expired` / `session:restored` 事件提示重新扫码。
- **白名单**：微信好友第一次发消息时，从日志中复制其 `userId`（形如 `xxx@im.wechat`，是协议分配的加密 ID，**不是微信号**）加入 `config.targetUserId`，否则消息会被管道过滤。
- **已知限制**（多为协议层约束）：
  - 只有加密 `userId`，**拿不到用户昵称/头像**（`nickName` 以 userId 兜底）
  - 当前仅文本消息进入管道，图片/语音/视频消息暂未接入（视觉中间件对微信侧不生效）
  - 仅按私聊处理，未支持群聊
  - 只能回复"先给机器人发过消息"的用户（协议要求 context_token），主动推送无上下文会失败
  - 富消息段发送（图片/数组型 `sendMsg` 载荷）尚未实现，会记日志提示后丢弃

### Web 管理面板

Bot 内置独立的 **面板 API 服务**（`core/api/`），与 Web 后端以独立进程运行，通过 WebSocket 双向通信：

- **连接模型**：Bot 做 WS 服务端，仅绑定 `127.0.0.1`，默认 `ws://127.0.0.1:2145/api/v1/ws`，与 NapCat → Bot 的反向 WS 模式同构
- **鉴权**：独立面板 token，连接后 5s 内完成 `auth` 握手，失败/超时直接断开（自定义关闭码 4401/4001）
- **协议**：请求/响应帧按 `id` 关联 + 服务端主动推送事件帧（`{type:"event", event, ts, data}`）
- **action 白名单**：`get_status` / `get_config` / `set_config` / `get_logs` / `list_actions`，未知 action 一律拒绝
- **配置脱敏**：`get_config` 输出键名脱敏 + 值级黑名单 + 嵌套对象/非纯标量数组过滤，密钥不外泄；`set_config` 仅白名单字段可热改
- **可靠性**：30s ping/pong 心跳回收死连接；日志/事件进环形缓冲（`config.web.logBufferSize`），断线重连后可按时间戳补拉

面板前端位于 `web/`（React 18 + Vite 8 + TypeScript），目前为骨架页面，`npm run dev` 独立启动，通过上述 WS 地址对接 API。

## 快速开始

### 环境要求

- Node.js >= 24（`npm start` 依赖 Node 原生 type stripping 直接运行 `.ts`；WeChat SDK 要求 >= 22）
- NapCat 客户端已运行并配置好反向 WebSocket 连接（QQ 接入必需；仅运行微信适配器则不需要）

### 安装与启动

```bash
git clone https://github.com/chail233/Cith
cd Cith
npm install
npm start
```

**npm 脚本：**

| 命令 | 说明 |
|------|------|
| `npm start` | 直接运行 `core/` 源码（Node 24 原生 type stripping 支持 .ts，开发推荐） |
| `npm run build` | tsc 编译 `core/` → `dist/`，并拷贝 SKILL.md 等非代码资源 |
| `npm run build:watch` | watch 模式构建（资源拷贝不会自动重跑，需手动 build） |
| `npm run start:dist` | 运行构建产物 `dist/index.js` |

> **`start` 与 `start:dist` 效果等价**：两者跑出来的机器人行为完全一致。
> - `configDev.js` 位于 `core/` 下且被 tsc 纳入编译，构建后会自动产出 `dist/configDev.js`，所以 `start:dist` 同样能加载开发配置（DevMode 合并、mcpServers 等），无需担心产物缺配置。
> - `app.pem`、`mcp/` 以 **cwd（项目根）** 解析，与从 `core` 还是 `dist` 启动无关。
> - 差异仅在非行为层面：`start` 依赖 Node 24 原生擦除类型、每次现场转译、改完即生效；`start:dist` 跑预编译纯 JS、启动更快、不依赖运行时 TS 支持，但必须先 `npm run build`（产物只与上次构建同样新鲜）。
>
> **推荐**：日常开发直接 `npm start`；上线部署用 `npm run build && npm run start:dist`。
>
> **`dist/` 不提交 git**：构建产物可由 `core/` 重新生成，已在 `.gitignore` 中忽略。

### 配置

所有配置集中在 `core/config.js` 中。

**开发环境：** 将 `config.js` 中的 `DevMode` 设为 `true`，在 `core/configDev.js` 中填写真实配置（该文件已 gitignore；`DevMode` 为 true 但文件缺失时进程会直接退出）。

**生产环境：** 将 `DevMode` 设为 `false`，直接在 `config.js` 中填写配置值。

**运行期持久化：** `config` 由 Proxy 包裹，任何顶层键赋值（如 `#ms` 切模型、`#pchat`、`#toolout`、面板 `set_config`）都会自动写入 `core/configOverride.json`，重启后叠加生效。`members`、`mcpServers`、`DevMode` 不落盘；密钥类（`aiAPIKEY`、`token` 等）会写入但需重启才生效。该文件同样已 gitignore。

主要配置项：

| 配置项 | 说明 |
|--------|------|
| `wsPort` | OneBot 反向 WebSocket 服务端口（默认 8080） |
| `token` | OneBot 鉴权 Token |
| `napcatHttpHost` | NapCat HTTP API 地址（默认 `127.0.0.1:3000`，图片获取等走 HTTP） |
| `owner` | 主人（管理员）用户 ID |
| `targetGroupId` | 目标群 ID 列表（字符串数组） |
| `targetUserId` | 目标用户 ID 列表：QQ 号（字符串）或微信加密 ID（形如 `xxx@im.wechat`，从日志复制） |
| `selfId` | 机器人 QQ 号 |
| `aiAPIKEY` | 阿里云 AI API Key（文本模型 + 长期记忆） |
| `visionAPIKEY` | 视觉模型 API Key |
| `CHAT_MODEL` | 聊天模型名称 |
| `VISION_MODEL` | 识图模型名称 |
| `ENABLE_LONG_TERM_MEMORY` | 是否启用云端长期记忆与用户画像（默认 false） |
| `mcpServers` | MCP Server 配置列表 |
| `readFileDirs` | `read_file`/`list_files` 允许的目录（相对 `core/`） |
| `runJsDirs` | `run_JS` 允许执行脚本的目录 |
| `editFileDirs` | `create_file`/`edit_file`/`delete_file` 允许的目录 |
| `web` | 面板 API 服务：`port` / `path` / `token` / `logBufferSize` |
| `githubToken` | GitHub API Token（skill-manager 安装技能、GitHub MCP 使用） |
| `EnableProactiveChat` | 主动聊天开关 |
| `PROACTIVE_CHAT_LIMIT` | 主动聊天触发阈值（默认 15 条） |
| `toolOutput` | 是否在群里播报工具调用（默认 false） |
| `members` | QQ 号 → 群昵称映射表 |

NapCat 反向 WebSocket 连接地址：`ws://127.0.0.1:8080/onebot/v11/ws`（端口随 `wsPort` 变化）。

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
    │   ├─ at-detector       → 解析 @ 对象 → ctx.at（@bot 时为“我”）
    │   └─ mini-program      → 处理小程序/链接分享
    │
    └─ 处理器（首个返回 true 即停止）
        ├─ keyword-commands  → 精确匹配关键词（CMD_MAP 当前为空，框架保留）
        ├─ user-commands     → # 前缀命令（#help、#plan 等）
        ├─ ai-chat           → @机器人（或私聊）时触发 Agent 循环
        ├─ repeater          → 复读检测
        └─ proactive-chat    → 记录上下文，达阈值时主动聊天
```

### Agent 对话流程

重构后的核心原则：**Agent 只负责"想"，不负责"说"**。

```
用户消息触发对话（pipeline/agent-runner.ts：runAgent）
    │  临时挂上 reply / tool-call 事件监听 → run → 分发链落定后摘监听
    ▼
Agent.run()（core/agent/Agent.ts，每会话一实例，AgentManager 池管理，空闲 30 分钟回收）
    │  本次对话开工前：检查并触发中期概括 → 重新扫描 skills 目录
    ▼
组装上下文（系统提示 + 强加载技能正文 + 技能列表 + MCP 列表 + 记忆概要 + 活跃任务计划 + 历史消息）
    │
    ▼
调用 LLM（携带全部工具定义）
    │
    ├─ 无工具调用 → 解析 JSON 回复 → 广播 "reply" 事件 → 写入会话记忆
    │
    └─ 有工具调用 → 同一轮多个调用并行执行 → 结果作为 system 痕迹回填记忆 → 再次请求（最多 30 轮）
        │           ├─ 本地工具 → 路径穿越防护 + 白名单门禁（白名单内放行，否则挂起确认）
        │           └─ MCP 工具 → 路由到对应 MCP Server
        ▼
事件消费方（agent-runner）通过适配器发送消息（分段、拟人化节流）
```

Agent 不持有任何聊天通道，所有输出以事件广播——换协议、加 Web 端可视化、接日志回放，只需再写一个监听者，不动 AI 核心。

### 用户命令

通过 `#` 前缀触发，部分命令需要管理员权限（管理员 = `config.owner`）：

| 命令 | 权限 | 说明 |
|------|------|------|
| `#help` | 所有人 | 显示指令列表 |
| `#skills` | 所有人 | 列出技能列表 |
| `#forceskills` | 所有人 | 列出当前强加载技能 |
| `#plan` | 所有人 | 查看当前任务计划 |
| `#mcp` | 所有人 | 列出 MCP 连接 |
| `#tools` | 所有人 | 列出当前可用工具 |
| `#msgs` | 管理员 | 列出短期记忆 |
| `#cmsgs` | 管理员 | 列出缓存记录 |
| `#sm` | 管理员 | 显示中期记忆概括 |
| `#clear` | 管理员 | 清除短期记忆 |
| `#compress` | 管理员 | 压缩短期记忆 |
| `#sessions` | 管理员 | 列出活跃会话（记忆条数/概要/空闲时长） |
| `#ms <模型>` | 管理员 | 切换聊天模型 |
| `#pchat <bool>` | 管理员 | 开关主动聊天 |
| `#toolout <bool>` | 管理员 | 开关工具调用通知发送 |
| `#do-yes <id>` | 管理员 | 确认执行危险操作 |
| `#do-no <id>` | 管理员 | 取消危险操作 |
| `#do-pending` | 管理员 | 列出待确认操作 |

---

## 项目结构

```
core/
├── index.js                    # 入口：初始化 MCP → 启动 WS 服务（QQ/微信）→ 启动面板 API
│
├── config.js                   # 统一配置（基础配置 + 常量 + 成员映射），Proxy 自动持久化
├── configDev.js                # 开发环境配置（gitignore，覆盖 config.js）
│
├── bot/                        # 通信层：servers（连接/生命周期）+ adapters（协议适配，可插拔）
│   ├── servers/
│   │   ├── OnebotServer.js     # QQ：反向 WebSocket 服务（NapCat 接入）
│   │   └── WechatBotServer.ts  # WeChat：iLink Bot 登录、二维码/会话事件、消息桥接
│   └── adapters/               # 协议适配器（继承 BaseAdapter）
│       ├── BaseAdapter.ts      # 抽象基类：定义 onMessage / sendMsg 契约
│       ├── OnebotAdapter.ts    # OneBot v11 协议实现
│       └── WechatBotAdapter.ts # 微信 iLink Bot 协议实现（@wechatbot/wechatbot）
│
├── api/                        # Web 面板 API（独立 WS 服务端）
│   ├── server.ts               # 启动/鉴权/心跳/广播
│   ├── router.ts               # action 白名单注册与分发
│   ├── types.ts                # 请求/响应/事件帧类型
│   ├── event-bus.ts            # EventEmitter 事件总线 + publish()
│   ├── event-log.ts            # 全局事件环形缓冲
│   ├── ring-buffer.ts          # 固定容量环形缓冲
│   ├── runtime-state.ts        # 运行时状态快照
│   └── actions/                # status / config / logs / meta（get_status、set_config 等）
│
├── types/                      # 跨模块共用类型定义（通信/管道层；Agent 独有类型在 agent/types.ts）
│   └── index.ts                # Context / CtxEvent / Space / MessageSegment
│
├── pipeline/                   # 事件处理管道
│   ├── index.js                # 管道编排：中间件 → 处理器
│   ├── context.ts              # 上下文构建与目标过滤
│   ├── middleware/             # 中间件（丰富上下文）
│   │   ├── image-recognizer.js # 图片识别
│   │   ├── at-detector.js      # @检测
│   │   └── mini-program.js     # 小程序/链接分享处理
│   ├── handlers/               # 处理器（首个命中即停止）
│   │   ├── keyword-commands.js # 关键词命令（CMD_MAP 当前为空）
│   │   ├── user-commands.js    # # 前缀命令
│   │   ├── ai-chat.js          # Agent 对话入口
│   │   ├── repeater.js         # 复读检测
│   │   └── proactive-chat.js   # 主动聊天
│   └── agent-runner.ts         # Agent 事件 → 适配器分发（节流发送）
│
├── agent/                      # Agent 核心（AI 相关代码全部内聚于此）
│   ├── Agent.ts                # Agent 类：循环主体 + 会话任务计划，只产出事件不碰通道
│   ├── AgentManager.ts         # 会话池：space → Agent 实例，空闲回收 / 数量上限
│   ├── contextBuilder.ts       # LLM 请求上下文组装
│   ├── replyParser.ts          # 模型回复解析（{action:[...]}）
│   ├── types.ts                # Agent 系统独有类型（ToolCall/ReplyPayload/Plan 等）
│   ├── approval-runner.ts      # 危险操作确认执行链
│   ├── client.js               # LLM API 客户端（文本 / 视觉）
│   ├── tools.js                # 工具定义、调度与路径门禁
│   ├── tool-approval.js        # 危险操作确认队列
│   ├── mcp-client.js           # MCP 客户端管理器
│   ├── skill.js                # Skill 加载器
│   ├── image.js                # 视觉 API
│   ├── long-term-memory.js     # 长期记忆 + 用户画像 API
│   └── recorder.js             # 三层记忆记录器（短期/缓存/概括）
│
├── services/                   # 外部服务封装
│   └── napcat.js               # NapCat HTTP API（get_image 等）
│
├── tools/                      # 独立工具模块
│   └── repeater.js             # 复读检测队列
│
├── data/                       # 静态数据
│   └── assets.js               # 内置图片 URL（孙巴二娘随机图）
│
├── skills/                     # Skill 技能目录（AI 可读写）
│   └── skill-manager/          # 内置：技能管理器
│
├── workspace/                  # 工作区（AI 可读写）
│
├── utils/                      # 工具函数
│   ├── logger.js               # 统一日志（同时推送到面板事件总线）
│   ├── file-security.js        # 路径解析 / 穿越防护 / 白名单校验
│   ├── extractText.ts          # 消息段纯文本提取（TS）
│   └── sleep.js / random.js / time.js / queue.js / image-type.js
│
```

```
scripts/                        # 构建辅助脚本
└── copy-assets.js              # 构建后将 skills/workspace 的非代码资源拷贝到 dist

web/                            # 面板前端（React 18 + Vite 8 + TS，独立 npm 工程，当前为骨架页面）
mcp/                            # 本地 MCP Server（gitignore；mcp/github-server 为 GitHub 示例）
assets/                         # 素材图片（SunbatwoGirl）

根目录：
tsconfig.json                   # IDE 类型检查基准配置（strict + noEmit，不产出文件）
tsconfig.build.json             # 构建配置（noCheck 只转译，遗留 JS 不阻塞产出）
```

---

## 开发指南

### 添加关键词命令

在 `pipeline/handlers/keyword-commands.js` 的 `CMD_MAP` 中添加（当前内置关键词命令已清空，框架保留）：

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

在 `agent/tools.js` 的 `tools` 数组中添加工具定义，并在 `toolMap` 中注册处理函数，新工具会自动出现在 AI 的可用工具列表中。

如果新工具带文件路径参数，还必须在 `pathToolWhitelist` 中登记 `{ dirKey, pathKey }`（指向白名单配置键与路径参数名），门禁才会按"执行对象是否在白名单目录内"自动放行或挂起。门禁统一在 `callTool()` 中完成，工具实现内部不需要重复校验白名单（目录穿越仍由 `resolveSrcPath` 兜底）。

### 添加 MCP Server

在 `configDev.js` 的 `mcpServers` 中添加配置：

```js
{
    name: "github",
    description: "GitHub 操作",
    transport: "stdio",        // 或 "sse" / "old_sse"
    command: "node",
    args: ["D:/path/to/mcp/github-server/index.js"],
}
```

AI 可通过 `list_mcp_tools` 工具动态加载该 Server 的所有工具。

### Skill 开发

1. 在 `core/skills/` 下创建目录
2. 创建 `SKILL.md`（frontmatter 元数据：`name`、`description`，可选 `force: true` 使其正文固定注入上下文）
3. 在 `scripts/` 子目录中编写 JS 脚本

脚本通过 `process.argv[2]` 接收 JSON 参数，通过 `console.log()` 输出结果。脚本在子进程中执行，30 秒超时。

### TypeScript 开发约定

项目为 JS 为主、逐步引入 TS 的混合结构，依赖 Node 24 原生 type stripping 直接运行 `.ts`：

- JS 文件引用 TS 模块时，import 路径**显式写 `.ts` 后缀**；构建时 tsc 自动重写为 `.js`（`rewriteRelativeImportExtensions`）
- 导入 interface **必须用 `import type`**，否则运行时因导出不存在而崩溃；JS 文件中引用类型用 JSDoc：`/** @typedef {import("./xxx.ts").Type} Type */`
- `.ts` 中只允许"可擦除语法"（禁用 `enum`、构造器参数属性等，由 `erasableSyntaxOnly` 约束）
- 类型检查由 IDE 实时提供（tsconfig.json，strict 模式）；构建走 tsconfig.build.json 的 `noCheck` 只转译，不提供 CLI 检查

### 安全设计

- **目录穿越防护**：`..` 等越出 `core/` 的路径被 `file-security.js` 硬拦截，是不可绕过的安全底线
- **白名单门禁**：文件类工具按执行对象目录判定——白名单目录（默认 `skills/`、`workspace/`）内直接放行，目录外挂起待管理员确认，兼顾安全与顺畅
- **子进程隔离**：JS 脚本在独立子进程中执行，带超时限制
- **写入保护**：`create_file` 禁止覆盖已有文件，`edit_file` 要求文本唯一匹配，防误改
- **面板 API**：仅绑定 `127.0.0.1`、独立 token 鉴权、action 白名单分发、配置输出脱敏、热改字段白名单、全量 try/catch 故障隔离（坏帧不杀连接）


---

## License

[MIT](LICENSE)
