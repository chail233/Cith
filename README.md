# SunbatwoBot

<div align="center">

[![GitHub Stars](https://img.shields.io/github/stars/chail233/SunbatwoBot?style=flat-square&logo=github&color=gold)](https://github.com/chail233/SunbatwoBot/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/chail233/SunbatwoBot?style=flat-square&logo=github)](https://github.com/chail233/SunbatwoBot/forks)
[![GitHub Issues](https://img.shields.io/github/issues/chail233/SunbatwoBot?style=flat-square&logo=github)](https://github.com/chail233/SunbatwoBot/issues)
[![License](https://img.shields.io/github/license/chail233/SunbatwoBot?style=flat-square)](https://github.com/chail233/SunbatwoBot/blob/master/LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![OneBot](https://img.shields.io/badge/OneBot-v11-black?style=flat-square)](https://github.com/botuniverse/onebot-11)

</div>

SunbatwoBot 是一个存在于聊天软件中的 **Agent**。它不只是一个聊天机器人——它拥有自主决策、工具调用、文件操作、记忆管理和技能扩展等能力，能够在聊天对话中像一个真正的"成员"一样参与交流和工作。

底层通信基于 NapCat + OneBot v11 协议，AI 能力由阿里云百炼平台驱动（支持 DeepSeek / Qwen 等模型）。

## 核心能力

### 自主 Agent 循环

AI 不再只是"一问一答"。它运行在一个 **多轮工具调用循环** 中：接收消息 → 推理 → 调用工具 → 观察结果 → 继续推理 → 输出回复。这个循环最多可执行 30 轮（可配置），让 AI 能够完成复杂的多步骤任务。

### 四层记忆系统

AI 拥有从短期到长期的完整记忆架构，在上下文窗口限制与信息保留之间取得平衡：

```
短期记忆（_messages）
  │ 最近 30 条对话，超出则挤入缓存
  ▼
中期缓存（_cache）
  │ 达到 30 条时触发 LLM 概括
  ▼
中期概括（_midSummary）
  │ 被新概括覆盖前，自动存入长期记忆
  ▼
长期记忆（阿里云百炼记忆库）
  │ AI 通过工具调用（get_memory）自主检索相关记忆
  ▼
拼入工具调用结果 → 供 LLM 参考
```

| 层级 | 存储位置 | 容量/周期 | 触发条件 |
|------|---------|-----------|----------|
| 短期记忆 | 内存 | 30 条 | 每次对话实时更新 |
| 中期缓存 | 内存 | 满 30 条触发概括 | 短期溢出时 |
| 中期概括 | 内存 | 每次概括覆盖 | 缓存满时 LLM 生成 |
| 长期记忆 | 云端记忆库 | 无上限 | 旧概括被替换时存入；AI 自主检索 |

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

所有文件操作都受到 **路径白名单** 和 **目录穿越防护** 的安全约束。

### 文件操作安全门禁

文件类工具（`read_file`、`list_files`、`run_JS`、`create_file`、`edit_file`、`delete_file`）以**执行对象所在目录**决定放行与否，而非按工具名一刀切：

- 操作对象位于对应白名单目录内（读→`readFileDirs`，执行→`runJsDirs`，增删改→`editFileDirs`，默认 `skills/`、`workspace/`）→ **直接放行**，不打扰管理员（跑 skill 脚本、写 workspace 不再被挡）。
- 操作对象在白名单之外 → **挂起待确认**，生成待确认编号：
  1. 群内通知：`操作对象不在白名单目录内，需要管理员确认。已登记为待确认操作 #xxxx`
  2. 管理员发送 `#do-yes xxxx` 确认后执行，或 `#do-no xxxx` 取消
  3. 待确认项 10 分钟超时自动作废
- 管理员本人发起、或工具调用已确认时跳过门禁。
- `../` 等目录穿越无论如何都被 `file-security.js` 硬拦截（既不直接放行也不挂起）。

> MCP 工具没有本地路径目标，不在此文件门禁范围内，按需调用。

### 用户画像

系统自动从对话中提取用户特征（爱好、性格、偏好等），存储到云端画像模板。AI 可通过 `get_user_profile` 工具查询特定 QQ 号用户的画像，实现个性化回应。

### MCP 工具扩展

支持连接外部 MCP（Model Context Protocol）Server，三种传输协议：

- **stdio**：本地子进程
- **old_sse**：旧版 SSE 协议
- **sse**：新版 Streamable HTTP 协议

通过 MCP，AI 可以获得几乎无限的工具扩展能力。你可以在配置中添加任意 MCP Server 来为 AI 增加新工具。

### Skill 技能系统

Skill 是包含 `SKILL.md` 描述文件的目录，可包含脚本供 AI 调用。AI 通过读取 SKILL.md 了解技能用法，通过 `run_JS` 执行技能脚本。

`SKILL.md` 的 frontmatter 元数据包含 `name`、`description`，以及可选的 `force`（布尔值）：

- **普通技能**：仅将 `name` + `description` 注入系统提示（技能列表），AI 判断相关时再用 `read_file` 按需读取正文，节省 token。
- **强加载技能（`force: true`）**：其 `SKILL.md` 正文（去除 frontmatter 后）会**固定注入每次对话的 system prompt**，确保关键技能 100% 可达、无需额外工具调用。

**每回合现取：** 每次 Agent 对话开工前都会重新扫描 `skills/` 目录，新增/删除/修改技能后下一条消息即生效，通常无需手动重载。

**内置技能：**
- `skill-manager`：从 GitHub 安装/卸载社区技能

技能可被社区开发和共享，AI 甚至可以自主安装新技能来扩展自身能力。

### 视觉能力

AI 具备图片识别能力。当群内发送图片时，自动调用视觉模型（Qwen）识别图片内容，将描述注入对话上下文，让 AI 能够"看到"并理解图片。

### 主动聊天

当群内连续多条消息没有 @机器人时，AI 会根据上下文判断是否主动参与对话，行为更自然。

## 快速开始

### 环境要求

- Node.js >= 24
- NapCat 客户端已运行并配置好反向 WebSocket 连接

### 安装与启动

```bash
git clone https://github.com/chail233/SunbatwoBot
cd SunbatwoBot
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
> - `app.pem`、`mcp/` 以 **cwd（项目根）** 解析，与从 `src` 还是 `dist` 启动无关。
> - 差异仅在非行为层面：`start` 依赖 Node 24 原生擦除类型、每次现场转译、改完即生效；`start:dist` 跑预编译纯 JS、启动更快、不依赖运行时 TS 支持，但必须先 `npm run build`（产物只与上次构建同样新鲜）。
>
> **推荐**：日常开发直接 `npm start`；上线部署用 `npm run build && npm run start:dist`。
>
> **`dist/` 不提交 git**：构建产物可由 `core/` 重新生成，已在 `.gitignore` 中忽略。

### 配置

所有配置集中在 `core/config.js` 中。

**开发环境：** 将 `config.js` 中的 `DevMode` 设为 `true`，在 `core/configDev.js` 中填写真实配置。

**生产环境：** 将 `DevMode` 设为 `false`，直接在 `config.js` 中填写配置值。

主要配置项：

| 配置项 | 说明 |
|--------|------|
| `token` | OneBot 鉴权 Token |
| `targetGroupId` | 目标群 ID 列表（字符串数组） |
| `selfId` | 机器人 QQ 号 |
| `aiAPIKEY` | 阿里云 AI API Key |
| `CHAT_MODEL` | 聊天模型名称 |
| `VISION_MODEL` | 识图模型名称 |
| `mcpServers` | MCP Server 配置列表 |
| `readFileDirs` | `read_file`/`list_files` 允许的目录（相对 `core/`） |
| `runJsDirs` | `run_JS` 允许执行脚本的目录 |
| `editFileDirs` | `create_file`/`edit_file`/`delete_file` 允许的目录 |
| `agentMode` | Agent 模式开关 |
| `members` | QQ 号 → 群昵称映射表 |

NapCat 反向 WebSocket 连接地址：`ws://127.0.0.1:8080/onebot/v11/ws`

---

## 架构

### 事件处理管道

```
NapCat 发送事件
    │
    ▼
bot/server.js ─── WebSocket 服务
    │
    ▼
bot/adapter/OnebotAdapter ─── OneBot 协议解析（继承 BaseAdapter）
    │
    ▼
pipeline/index.js ─── 管道编排
    │
    ├─ 中间件（全部执行，丰富上下文）
    │   ├─ image-recognizer  → 识别图片 → ctx.imageDescription
    │   ├─ at-detector       → 检测 @机器人 → ctx.isAtBot
    │   └─ mini-program      → 处理小程序/链接分享
    │
    └─ 处理器（首个返回 true 即停止）
        ├─ keyword-commands  → 精确匹配关键词（"来句台词"等）
        ├─ user-commands     → # 前缀命令（#help、#gw 等）
        ├─ ai-chat           → @机器人时触发 Agent 循环
        ├─ repeater          → 复读检测
        └─ proactive-chat    → 记录上下文，达阈值时主动聊天
```

### Agent 对话流程

```
用户消息进入 Agent 循环
    │
    ▼
构建消息上下文（系统提示 + 强加载技能正文 + 技能列表 + MCP 列表 + 记忆概要 + 历史消息）
    │
    ▼
调用 LLM（携带全部工具定义）
    │
    ├─ 无工具调用 → 解析 JSON 回复 → 分段发送消息
    │
    └─ 有工具调用 → 逐个执行工具
        │           ├─ 本地工具 → 路径穿越防护 + 白名单门禁（白名单内放行，否则挂起确认）
        │           └─ MCP 工具 → 路由到对应 MCP Server
        │
        ▼
    工具结果注入上下文 → 再次调用 LLM → 循环（最多 30 轮）
```

### 用户命令

通过 `#` 前缀触发，部分命令需要管理员权限：

| 命令 | 权限 | 说明 |
|------|------|------|
| `#help` | 所有人 | 显示指令列表 |
| `#gw <城市>` | 所有人 | 查询天气 |
| `#model` | 所有人 | 查询可用模型 |
| `#skills` | 所有人 | 列出技能列表 |
| `#forceskills` | 所有人 | 列出当前强加载技能 |
| `#mcp` | 所有人 | 列出 MCP 连接 |
| `#tools` | 所有人 | 列出当前可用工具 |
| `#msgs` | 管理员 | 列出短期记忆 |
| `#cmsgs` | 管理员 | 列出缓存记录 |
| `#sm` | 管理员 | 显示中期记忆概括 |
| `#clear` | 管理员 | 清除短期记忆 |
| `#compress` | 管理员 | 压缩短期记忆 |
| `#ms <模型>` | 管理员 | 切换聊天模型 |
| `#pchat <bool>` | 管理员 | 开关主动聊天 |
| `#agent <bool>` | 管理员 | 开关 Agent 模式 |
| `#reloadskls` | 管理员 | 重新加载技能 |
| `#do-yes <id>` | 管理员 | 确认执行危险操作 |
| `#do-no <id>` | 管理员 | 取消危险操作 |
| `#do-pending` | 管理员 | 列出待确认操作 |

---

## 项目结构

```
src/
├── index.js                    # 入口：初始化 MCP → 启动 WebSocket 服务
│
├── config.js                   # 统一配置（基础配置 + 常量 + 成员映射）
├── configDev.js                # 开发环境配置（gitignore，覆盖 config.js）
│
├── bot/                        # 通信层
│   ├── server.js               # WebSocket 服务
│   └── adapter/                # 协议适配器（可插拔）
│       ├── BaseAdapter.ts      # 抽象基类：定义 onMessage / sendMsg 契约
│       └── OnebotAdapter.ts    # OneBot v11 协议实现
│
├── types/                      # 跨模块共用类型定义
│   └── index.ts                # Context / CtxEvent / Space / MessageSegment
│
├── pipeline/                   # 事件处理管道
│   ├── index.js                # 管道编排：中间件 → 处理器
│   ├── context.ts              # 上下文构建（TS）
│   ├── middleware/              # 中间件（丰富上下文）
│   │   ├── image-recognizer.js # 图片识别
│   │   ├── at-detector.js      # @检测
│   │   └── mini-program.js     # 小程序/链接分享处理
│   └── handlers/               # 处理器（首个命中即停止）
│       ├── keyword-commands.js # 关键词命令
│       ├── user-commands.js    # # 前缀命令
│       ├── ai-chat.js          # Agent 对话入口
│       ├── repeater.js         # 复读检测
│       └── proactive-chat.js   # 主动聊天
│
├── llm/                        # Agent 核心
│   ├── client.js               # LLM API 客户端
│   ├── chat.js                 # Agent 循环（工具调用 + 多轮推理）
│   ├── tools.js                # 工具定义与调度
│   ├── tool-approval.js        # 危险操作确认队列
│   ├── mcp-client.js           # MCP 客户端管理器
│   ├── skill.js                # Skill 加载器
│   ├── image.js                # 视觉 API
│   ├── long-term-memory.js     # 长期记忆 + 用户画像 API
│   └── recorder.js             # 四层记忆管理器
│
├── services/                   # 外部服务封装
│   ├── napcat.js               # NapCat HTTP API
│   ├── acg.js                  # ACG 图片 API
│   ├── hitokoto.js             # 一言 API
│   ├── weather.js              # 和风天气 API
│
├── skills/                     # Skill 技能目录（AI 可读写）
│   └── skill-manager/          # 内置：技能管理器
│
├── workspace/                  # 工作区（AI 可读写）
│
├── utils/                      # 工具函数
│   ├── logger.js               # 统一日志
│   ├── file-security.js        # 路径安全校验
│   ├── extractText.ts          # 消息段纯文本提取（TS）
│   ├── sleep.js / random.js / time.js / queue.js / image-type.js
│
```

```
scripts/
└── copy-assets.js              # 构建后将 skills/workspace 的非 JS 资源拷贝到 dist

根目录：
tsconfig.json                   # IDE 类型检查基准配置（strict + noEmit，不产出文件）
tsconfig.build.json             # 构建配置（noCheck 只转译，遗留 JS 不阻塞产出）
```

---

## 开发指南

### 添加关键词命令

在 `pipeline/handlers/keyword-commands.js` 的 `CMD_MAP` 中添加：

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
    params: [{ name: "参数名", desc: "参数说明" }],
    handler: async (args, ctx) => {
        return "回复文本";
    }
}
```

### 添加新工具

在 `llm/tools.js` 的 `tools` 数组中添加工具定义，在 `toolMap` 中注册处理函数。新工具会自动出现在 AI 的可用工具列表中。

### 添加 MCP Server

在 `configDev.js` 的 `mcpServers` 中添加配置：

```js
{
    name: "my_mcp",
    description: "我的 MCP 服务",
    transport: "stdio",        // 或 "sse" / "old_sse"
    command: "node",
    args: ["path/to/server.js"],
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


---

## License

[MIT](LICENSE)
