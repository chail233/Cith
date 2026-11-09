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

**Cith** 是一个开源的**个人 Agent**：跑在你自己的设备上，住在你最常用的聊天软件里（QQ / 微信），7×24 小时在线。

它不是又一个聊天机器人——聊天机器人等你的下一句话，它等的是把事情办完。你说一句需求，它自己拆解任务、调用工具、观察结果、继续推理，办妥之后再像朋友一样回你一条消息：看得懂你发的图，说话有节奏，偶尔还带张表情包。

- **住在聊天软件里** —— QQ、微信哪个常用住哪个，私聊群聊都行，像跟一位普通联系人说话一样交代任务
- **真正能做事** —— 多轮推理中自主调用工具：执行 shell 命令与脚本、动态接入 MCP 工具；长任务中还会主动播报"正在做什么"，把一句需求变成一件办完的事
- **越用越懂你** —— 四层记忆 + 本地语义检索，记得你的一切，越用越成为独一无二的"你的"AI；上下文超长自动摘要归档，聊得再久也不失忆
- **自己扩展自己** —— `SKILL.md` 驱动的技能系统，支持从 GitHub 安装社区技能，它甚至可以自己给自己装技能
- **会主动干活** —— 会给自己设闹钟，到点自动苏醒执行任务；群里冷场时也会判断要不要搭句话
- **默认自持** —— 部署在自己的机器上，OpenAI 兼容协议接入任意模型端点；shell 命令有 guard 审查与待确认队列兜底，能干活但不越权
- **自带驾驶舱** —— 开箱即用的 Web 管理面板：运行状态、Token 用量与花销、实时事件日志、配置热改、提示词在线编辑

## 快速开始

### 环境要求

- Node.js >= 24（`npm start` 依赖 Node 原生 type stripping 直接运行 `.ts`；WeChat SDK 要求 >= 22）
- QQ 接入：NapCat 客户端已运行并配置好反向 WebSocket（仅运行微信适配器则不需要）

### 安装与启动

#### 方式一：一键初始化（推荐）

```bash
git clone https://github.com/chail233/Cith
cd Cith

# Windows（PowerShell）
powershell -ExecutionPolicy Bypass -File setup.ps1

# Linux / macOS
bash setup.sh
```

脚本会依次完成：检查 Node 版本 → 安装根目录与 `web/` 依赖 → 交互式询问必填项（`owner`、`selfId`、模型地址与 Key、NapCat 地址、面板端口与密码等）→ 生成 `core/config.json` 与 `web/.env`（`BOT_API_TOKEN` 自动与 Bot 的 `web.token` 对齐）→ 校验配置能否真实加载 → 端口检查 →（首次）构建 Web 面板 → 前台启动并打印面板地址与 NapCat 反向 WS 地址。

- 只生成两个已被 gitignore 的文件，**不修改** `core/config.js`；重复运行会先备份旧文件，不会静默覆盖
- 密钥输入不回显，脚本全程不打印密钥原文
- `npm run setup -- --check`：只读检查（环境、依赖、配置能否加载、端口、`.env` 是否与 Bot 对齐），开发与生产同一套配置机制，均适用
- `npm run setup -- --no-start`：只写配置并校验，不启动；`--force`：跳过「保持现有配置」的询问，备份后重新生成

#### 方式二：手动配置

```bash
git clone https://github.com/chail233/Cith
cd Cith
npm install
npm start
```

NapCat 反向 WebSocket 连接地址：`ws://127.0.0.1:8080/onebot/v11/ws`（端口随 `wsPort` 变化）。

> 该端点与 NapCat 的 HTTP 接口复用同一个 `token`：握手需携带 `Authorization: Bearer <token>`（部分客户端用 `?access_token=` 查询参数亦可），不匹配直接 401 拒绝并按来源 IP 记告警。`token` 留空或仍是模板占位符时不做校验，启动自检会提示风险。

**npm 脚本：**

| 命令 | 说明 |
|------|------|
| `npm start` | 直接运行 `core/` 源码（开发推荐，改完即生效） |
| `npm run build` | tsc 编译 `core/` → `dist/`，并拷贝 SKILL.md 等非代码资源 |
| `npm run build:watch` | watch 模式构建（资源拷贝不会自动重跑，需手动 build） |
| `npm run build:web` | 编译 Web 面板（`web/`：tsc + Vite → `web/dist/`，需先装好 `web/node_modules`） |
| `npm run build:all` | 一键编译 core + web（先 `build` 后 `build:web`） |
| `npm run start:dist` | 运行构建产物 `dist/index.js`（上线部署用） |

> `start` 与 `start:dist` 行为完全一致，差异仅在运行方式：`start` 依赖 Node 24 现场转译 TS，`start:dist` 跑预编译纯 JS、启动更快，但需先 `npm run build`。`dist/` 不提交 git。

### 更新

```bash
bash update.sh              # 拉取当前分支 + 按需装依赖 + 编译后端（前端已装过则一并编译）
bash update.sh --web        # 强制连 Web 面板一起编译
bash update.sh --stash      # 自动暂存本地未提交改动，结束后恢复
bash update.sh --force      # 远端无新提交也重新编译（修本地 dist 时用）
```

脚本只处理已跟踪文件，`core/config.json`、`mcp/`、`core/data/` 等被忽略的本地文件不会被触碰；拉取使用 `--ff-only`，本地分叉时直接报错而不是生成 merge commit；依赖文件（`package.json` / lock）未变时跳过 `npm install`。更新完成不会自动重启服务，按运行方式执行 `npm start` / `npm run start:dist` / `pm2 restart <应用名>` 生效。

### 配置

配置分两层：`core/config.js` 是**随仓库分发的默认值**（可提交，不含真实密钥），`core/config.json` 是**用户配置层**（已 gitignore，只写需要覆盖的键）。启动时按 `config.js → config.json` 合并，**开发与生产共用同一套机制**，`git pull` 永远不会覆盖你的配置。

- **命名规范**：配置键统一 camelCase（`chatModel`、`aiApiKey`、`llmApiUrl` …）。旧版大写键（`CHAT_MODEL`、`aiAPIKEY` 等）仍兼容：启动时自动映射为新键、迁移落盘并打印改名提示。
- **覆盖规则**：标量与数组整体覆盖；`web` 这类普通对象只覆盖写了的字段（改端口不用把 `path` / `logBufferSize` 一起写全）。
- **JSON 表达不了的结构**：`members` 写成 `{"QQ号": "昵称"}` 普通对象，加载时转为 Map；`mcpServers[].command` 写 `"$NODE"` 表示用当前运行的 node 可执行文件。
- **写说明文字**：标准 JSON 不支持注释，以 `$` 或 `_` 开头的键只作说明，加载时忽略。
- **坏配置不会静默降级**：`config.json` 解析失败会中止启动并报出具体错误（避免带着占位符密钥运行）；文件带 UTF-8 BOM 也能正确读取。
- **配置脱离代码目录**：生产可把配置文件放到仓库外，用环境变量 `CITH_CONFIG=/etc/cith/config.json` 指向它。
- **运行期持久化**：`config` 由 Proxy 包裹，运行期的顶层键赋值（`#ms` 切模型、面板 `set_config` 等）会读-改-写回 `config.json`，保留你手写的其他键（`members` / `mcpServers` 不落盘）。

> 跑 `dist/` 构建产物时配置文件位于 `dist/config.json`：`npm run build` 会用 `core/config.json` **覆盖**它，唯一真源始终是 `core/config.json`。直接用 `start:dist` 跑且在上面热改（`#ms` / 面板保存）时，热改值会在下次构建时被覆盖，需要保留就同步回 `core/config.json`；或用 `CITH_CONFIG` 指向仓库外的固定文件（构建不会碰它）。

**启动自检**：进程启动时会检查关键配置是否仍是模板占位符（`owner`、会话白名单、`aiApiKey`、`llmApiUrl`/`chatModel` 等），把「致命 / 提示」两级问题汇总成中文清单打印到控制台，并存入运行状态供面板「运行状态」页顶部常驻展示——避免配置没填对却看着一切正常、实际收不到任何回复。

主要配置项：

| 配置项 | 说明 |
|--------|------|
| `wsPort` | OneBot 反向 WebSocket 服务端口（默认 8080） |
| `token` | NapCat 鉴权 Token，HTTP 请求与反向 WebSocket 握手共用同一把 |
| `napcatHttpHost` | NapCat HTTP API 地址（默认 `127.0.0.1:3000`，图片获取等走 HTTP） |
| `owner` | 主人（管理员）用户 ID |
| `targetGroupId` / `targetUserId` | 目标群 / 用户 ID 列表（管理员在目标会话里发 `#bind` 可自动加入） |
| `selfId` | 机器人 QQ 号 |
| `aiApiKey` / `visionApiKey` | 文本模型与视觉模型 API Key |
| `chatModel` / `visionModel` | 聊天 / 识图模型名称 |
| `llmApiUrl` | LLM API 地址（OpenAI 兼容协议） |
| `enableLongTermMemory` / `memoryStorePath` | 是否启用本地长期记忆与记忆文件路径（默认 false） |
| `memoryEmbedProvider` / `memoryEmbedModel` | embedding 提供方（`ollama` 本地 / `openai` API 兼容接口）与模型名（本地默认 `bge-m3`；API 如百炼 `text-embedding-v4`） |
| `memoryOllamaUrl` | 本地 Ollama 地址（provider 为 `ollama` 时生效） |
| `memoryEmbedBaseUrl` / `memoryEmbedApiKey` | OpenAI 兼容接口地址与密钥（provider 为 `openai` 时生效；如百炼 `https://dashscope.aliyuncs.com/compatible-mode/v1`） |
| `mcpServers` | MCP Server 配置列表（`config.js` 默认自带 `websearch`；按 `name` 增量合并，只写要加/要改的项） |
| `shellGate` | run_shell 门禁模式：`guard`（默认，所有 run_shell 都经小模型审查）/ `open`（仅非管理员审查，管理员直通） |
| `guardApiUrl` / `guardApiKey` / `guardModel` | guard 模型端点与密钥（缺省回落 `llmApiUrl` / `aiApiKey`）；`guardModel` 未配置时需审查的调用逐条挂起等确认 |
| `web` | 面板 API 服务：`port` / `path` / `token` / `logBufferSize` |
| `githubToken` | GitHub API Token（skill-manager 安装技能、GitHub MCP 使用） |
| `enableProactiveChat` / `proactiveChatLimit` | 主动聊天开关与触发阈值（默认 15 条） |
| `toolOutput` | 是否在群里播报工具调用（默认 false） |
| `members` | QQ 号 → 群昵称映射表 |

---

## 核心能力

### 自主 Agent 循环

AI 运行在一个多轮工具调用循环中：接收消息 → 推理 → 调用工具（同轮多个调用并行执行）→ 观察结果 → 继续推理 → 输出回复，最多 30 轮（`toolChainMaxLength` 可配置）。单个工具失败不中断循环，错误原因回写为工具结果，交给模型自我修正。工具调用痕迹以 `system` 消息回填会话记忆，兼容只接受 system/user/assistant 的消息接口。

循环中 AI 可通过 `manage_plan` 维护一份**会话任务计划**（总体目标 + 带状态的步骤清单），每轮自动回注上下文，长链条任务不丢目标，用户可用 `#plan` 查看。耗时较长的任务里可以用 `report_progress` 播报一句“正在做什么”——播报走与正常回复相同的 `reply` 事件链，消息顺序与拟人节奏一致，不会打断待发回复。

Agent 本身不持有任何聊天通道，所有输出以事件广播；同一会话同时只允许一个模型请求，避免并发回复串台。

### 分层记忆系统

从短期到长期的完整记忆架构，以「预估 token 体积」而非消息条数守护上下文：

| 层级 | 存储位置 | 容量/周期 | 触发条件 |
|------|---------|-----------|----------|
| 短期记忆 | 内存 | 不按条数裁剪，按 `chatSummaryThresholdTokens` 守护 | 每次对话实时更新 |
| 中期概括 | 内存 | 滚动保留最近 60 条事实 | 一轮 Agent 结束后上下文超聊天阈值 |
| 长期记忆 | 本地 rememori 文件（`memoryStorePath`） | 最多 `memoryMaxRecords` 条（默认 2000） | 摘要产出的每条事实逐条存入（一条事实 = 一条记忆）；AI 通过 `get_memory` 自主检索 |

长期记忆由 `enableLongTermMemory` 控制，**默认开启**；embedding 二选一：本地 [Ollama](https://ollama.com)（`ollama pull bge-m3`，配 `memoryOllamaUrl`），或任意 OpenAI 兼容接口（`memoryEmbedProvider: "openai"`，配 `memoryEmbedBaseUrl` + `memoryEmbedApiKey`，如阿里云百炼 `text-embedding-v4`）。**换 embedding 提供方或模型 = 旧向量全部失效**，需删除 `memoryStorePath` 文件重新积累。记忆文件是 append-only JSONL，**只支持单进程读写**，不要同时用别的进程打开同一个文件。启动时会做一次维护（`prune` → 容量淘汰 → `compact` 折叠），运行期间每成功写入 `memoryMaintainEveryWrites` 条（默认 100，设 0 关闭）再执行一次；条数超出 `memoryMaxRecords`（默认 2000，设 0 不限）时按 importance 升序、创建时间升序淘汰最弱最旧的记录（写入不足 24 小时的不参与）。实现细节见 [docs/rememori/使用说明.md](docs/rememori/使用说明.md)。

记忆按会话隔离（`AgentManager` 会话池懒创建）：空闲 30 分钟自动回收（回收前摘要归档），会话数超上限（50）时按最久未活跃淘汰。可用 `#sessions` 查看各会话记忆状态。注意：短期/中期记忆按会话隔离，长期记忆**不分会话**（不使用 tag，所有会话共用一个检索空间）。

**上下文两级阈值**：

- **工作阈值**（`contextBudgetTokens`，默认 60000 token）：Agent 循环内每轮请求前检查上下文体积，超阈值就从最旧的开始把工具调用痕迹（`system` 消息）折叠成「首 200 字 + 尾 100 字」的截断形态，折到预算一半以下即停（减少改写次数，保住服务商前缀缓存）。折叠是纯内存操作、不调模型，靠 `[已折叠]` 前缀保证幂等；原文短于 800 字的消息不折——折了反而更占地方。被折掉的内容模型需要时重新调用工具即可取回。
- **聊天阈值**（`chatSummaryThresholdTokens`，默认 40000 token）：整个 Agent 跑完后检查记录器维护的预估上下文大小（按约 2.5 字符/token 增量累计，不按条数裁剪），超阈值就**后台静默摘要**——把较旧的对话提取成事实清单逐条写入长期记忆、追加进中期概括，并只保留尾部约 30% 体积的原文，避免下一轮丢掉即时语境。摘要是纯后台任务，不阻塞监听器摘除与下一轮对话；模型调用失败时原文原样保留，不会静默丢历史。

**前缀缓存友好的消息顺序**：稳定内容靠前、易变内容靠后。系统提示、技能/MCP/标签清单、记忆概要属于低频变化项；活跃计划与唤醒说明这类每条消息都可能变的项被压到**历史之后**。这样计划状态一更新、闹钟一响，只有尾部新增内容需要重算，而不会出现“计划变一个字，整段历史全部失效”的塌缩。实测易变场景下的理论命中率从 ~25% 提升到 ~94%。

### 工具调用（Function Calling）

AI 可自主判断并调用以下工具：

| 工具 | 功能 |
|------|------|
| `get_memory` | 语义检索长期记忆：可传 `queries` 数组按多条语句分别召回（合并去重取前 topK），不传则取最近 5 条消息逐条检索；每条结果带 `[绝对日期，距今]` 的入库时间 |
| `run_shell` | 执行系统 shell 命令并返回输出与退出码（Windows 走 PowerShell、其余 bash），文件与脚本操作统一走这里；命令经小模型安全审查（`open` 模式下管理员豁免） |
| `recognize_image` | 按需识别消息中的图片：传入图片段 `media.localPath` 返回内容描述（魔数校验，仅 jpg/png/webp） |
| `manage_mcp` | 维护 MCP 激活列表：`activate` 让该服务器工具进入工具列表，`deactivate` 用完移出 |
| `manage_plan` | 创建/更新当前会话的任务计划 |
| `report_progress` | 长任务中向用户简短播报当前在做什么，避免长时间静默 |
| `schedule` | 给自己设定时任务，到点自动苏醒 |
| `list_stickers` | 获取完整表情包列表（文件路径 + 画面描述），AI 挑选后以 image 段发送 |

**命令安全门禁**：`run_shell` 非管理员任何模式都经小模型审查；管理员仅 `guard` 模式（默认）审查、`open` 模式直通。审查为无状态三分类（`allow` 放行，`deny` / `unsure` / 未配置 `guardModel` / 调用失败一律挂起，生成编号 `#xxxx`，管理员 `#do-yes` / `#do-no` 处置，10 分钟超时作废）。挂起时 Agent 循环当场中止、挂起信息不回给模型，由代码通过只对 Adapter 可见的 `tool_approval` 消息段直接发消息请求确认（QQ 群里会 @ 发起人），确认后的执行结果再注入对话上下文；拒绝则把「未执行」写回上下文，让模型停止重试。

### Skill 技能系统

Skill 是包含 `SKILL.md` 描述文件的目录，可附带脚本供 AI 执行。frontmatter 元数据（`name`、`description`、可选 `force`）决定加载方式：

- **普通技能**：仅将 `name` + `description` 注入技能列表，AI 判断相关时再按需读取正文，节省 token。
- **强加载技能（`force: true`）**：正文固定注入每次对话的 system prompt，确保关键技能 100% 可达。

每次对话开工前重新扫描 `skills/` 目录，技能增删改下一条消息即生效。内置 `skill-manager` 支持从 GitHub 安装/卸载技能、设置强加载（需管理员确认）——技能可被社区开发共享，AI 甚至可以自主安装新技能扩展自身能力。

### MCP 工具扩展

支持连接外部 MCP Server（**stdio** 本地子进程 / **old_sse** 旧版 SSE / **sse** 新版 Streamable HTTP），为 AI 提供几乎无限的工具扩展。MCP 工具不一次性塞进上下文，也不是“一次性加载”：服务器清单（名称/描述/激活状态）固定注入每轮上下文，AI 用 `manage_mcp` 维护一份**激活列表**（`activate` / `deactivate`），处于激活状态的 Server 的工具每轮自动出现在工具列表中，以 `mcp_<服务器名>_<工具名>` 调用，直到被取消激活——激活状态不变时工具数组保持完全一致，不会反复打断服务商前缀缓存。旧的 `mcp_<原工具名>` 仅在工具名唯一时可用。`mcp/github-server` 是一个现成的 GitHub MCP Server 示例。

### 特色行为

- **视觉能力**：群内图片自动调用视觉模型识别内容并注入上下文，让 AI 能"看到"图片（独立 `visionModel` / `visionApiKey` 配置）。
- **主动聊天**：群内累计 `proactiveChatLimit` 条无人 @ 的消息后，AI 带完整上下文被唤醒，自主判断是否参与对话；计数在第 N 条消息上触发，AI 接话（或被 @ 对话）后归零，`#pchat` 可整体开关，阈值设为 `<= 0` 等同于关闭。上一轮模型请求尚未结束时不会插队，计数保留到下一条消息再试。
- **定时任务**：AI 可通过 `schedule` 工具"给自己设闹钟"（一次性 / 固定间隔 / 每日定点 / cron），到点触发完整 Agent 苏醒流程。任务持久化到 `data/schedule.json`，重启不丢失，停机期间错过的触发按追赶策略处理。
- **表情包**：内置表情包库（`manifest.json` 描述每张图的画面），AI 调用 `list_stickers` 拿到全量列表（文件路径 + 画面描述）后按语境选图，以 image 消息段直接发送，让回复更生动。

### 多平台接入

| 平台 | Server | Adapter |
|------|--------|---------|
| QQ | `OnebotServer`（NapCat + OneBot v11，反向 WebSocket 接入，握手 token 鉴权） | `OnebotAdapter` |
| 微信 | `WechatBotServer`（官方 iLink Bot 协议，扫码登录，凭证持久化重启复用） | `WechatBotAdapter` |

**设计模式：Server 接收并格式化信息，Adapter 处理对外的动作。** Server 继承 `BaseServer` 抽象基类：`toSegments` 把平台消息一次性转成统一消息段（图片就地下载/解析落地，写好 `media.localPath`），`toEventMeta` 产出会话与发送者元信息，基类 `dispatch` 统一装配 `CtxEvent` 推入管道。Adapter 继承 `BaseAdapter` 抽象基类，只实现 `sendMsg()` 按统一消息段类型执行平台动作。收发两个方向都走统一消息段：模型回复产出 `{action:[消息段]}`（词表 text / image / file / mention / reply，表情包即 image 段），`replyParser` 归一化后按段顺序逐个发送，平台不支持的段类型由 Adapter 自动跳过（如微信不支持 @ 与引用回复）。接入新平台 = 写这两个子类，管道与处理器零改动。

微信侧为协议层约束的已知限制：好友首次发消息后需把其加密 `userId` 加入 `targetUserId` 白名单（管理员直接在该私聊中发送 `#bind` 即可，无需手抄日志）；拿不到昵称/头像；文本与图片消息、仅私聊；只能回复主动发过消息的用户。

**同机多实例**：登录凭证（`credentials`）、长轮询游标（`cursor`）、`context_tokens`、`typing_tickets` 全部落在同一个目录，默认是 `~/.wechatbot`。两个进程共用会互抢 token、互相覆盖游标导致丢消息，一边 `session:expired` 清空凭证还会把另一边一起踢下线。多开时给每个实例配独立的 `wechatStorageDir`（支持 `~`、绝对路径、相对项目根的路径），启动日志会打印实际目录以及是「复用已保存凭证」还是「本次扫码登录」。同一个微信账号也只能被一个进程登录。

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
| 运行状态 | 运行时长 / OneBot 在线 / MCP 连接数 / 内存 / Node 版本 + Token 用量与花销（今日 / 近 7 天 / 累计，含缓存命中率与金额）+ 最近事件速览 |
| 模型价格 | 按模型填「元 / 百万 tokens」单价（输入 / 缓存命中 / 输出），保存即时生效，用量金额按当前价目重算 |
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

> **花销口径**：用量只记 token 数，金额是读取时按「模型价格」页（或 `core/data/model-pricing.json`）的价目现算的，因此改价后历史记录会自动按新价重算；价格表里没有的模型只统计 token 不折算金额，页面上会列为「未计价」。缓存命中价留空表示与输入价相同，embedding 调用（长期记忆向量化）不计入此统计。

---

## 架构

### 事件处理管道

```
QQ：NapCat 发送事件                     WeChat：iLink 长轮询收到消息
    │                                       │
    ▼                                       ▼
bot/servers/*（BaseServer 子类）—— Server 接收并格式化信息
    │  OnebotServer：反向 WS 服务 + 鉴权；toSegments 把 OneBot 段转统一段（图片就地解析本地路径）
    │  WechatBotServer：扫码登录 / 会话管理；toSegments 下载解密图片并落地（media.localPath）
    │  基类 dispatch：toSegments + toEventMeta → 统一装配 CtxEvent 推入管道
    └──────────────────┬────────────────────┘
                       ▼
        pipeline/context.ts 构建 Context（ctx.message 统一消息段 + ctx.messageId）→ pipeline/index.js 管道编排
    │  （仅 targetGroupId / targetUserId 命中的消息继续；管理员可在未授权会话发 #bind 完成首次绑定）
    │
    ├─ 中间件（全部执行，丰富上下文）
    │   └─ image-recognizer  → 读 media.localPath 识别图片 → ctx.imageDescription
    │
    │  @、图片、链接卡片等一律从统一消息段 ctx.message 取，不再有独立中间件
    │
    └─ 处理器（首个返回 true 即停止）
        ├─ user-commands     → # 前缀命令（#help、#plan 等）
        ├─ ai-chat           → @机器人（或私聊）时触发 Agent 循环
        └─ proactive-chat    → 记录上下文，达阈值时主动聊天
                       │
                       ▼
bot/adapters/*（BaseAdapter 子类）—— Adapter 处理对外的动作
    └─ sendMsg() 把回复发回平台（分段、拟人化节流由 agent-runner 编排）
```

### Agent 对话流程

核心原则：**Agent 只负责"想"，不负责"说"**。

```
用户消息触发对话（pipeline/agent-runner.ts：runAgent）
    │  临时挂上 reply / tool-call / approval 事件监听 → run → 分发链落定后摘监听
    ▼
Agent.run()（core/agent/Agent.ts，每会话一实例，AgentManager 池管理）
    │  开工前：重新扫描 skills 目录
    │  每轮请求前：工作阈值（contextBudgetTokens）→ 折叠最旧的工具痕迹
    ▼
组装上下文（系统提示 + 强加载技能 + 技能/MCP 列表 + 记忆概要 + 历史 + 尾部易变项：活跃计划 / 唤醒说明）
    ▼
调用 LLM（携带全部工具定义）
    ├─ 无工具调用 → 解析 JSON 回复 → 广播 "reply" 事件 → 写入会话记忆
    ├─ 工具被门禁挂起 → 中断本轮（挂起信息不给模型）→ 广播 "approval" 事件
    │   └─ agent-runner 把 tool_approval 段交给适配器发出确认询问
    └─ 有工具调用 → 并行执行 → 结果回填记忆 → 再次请求（最多 30 轮）
        ├─ 本地工具 → 路径穿越防护 + 白名单门禁
        └─ MCP 工具 → 路由到对应 MCP Server
    ▼
事件消费方（agent-runner）通过适配器发送消息（分段、拟人化节流）
    ▼
run 结束：聊天阈值（chatSummaryThresholdTokens）→ 后台静默摘要，不阻塞分发
```

Agent 不持有任何聊天通道，所有输出以事件广播——换协议、加 Web 端可视化、接日志回放，只需再写一个监听者，不动 AI 核心。

### 用户命令

`#` 前缀触发，管理员 = `config.owner`：

| 命令 | 权限 | 说明 |
|------|------|------|
| `#help` / `#skills` / `#forceskills` | 所有人 | 指令列表 / 技能列表 / 强加载技能 |
| `#plan` / `#mcp` / `#tools` | 所有人 | 任务计划 / MCP 连接 / 可用工具 |
| `#sm` | 管理员 | 中期概括 |
| `#clear` / `#compress` | 管理员 | 清除短期记忆 / 立即摘要压缩 |
| `#sessions` | 管理员 | 列出活跃会话（记忆条数/体积/概要/空闲时长） |
| `#tokens [天数]` | 管理员 | Token 用量与花销（默认近 7 天，含未计价模型提示） |
| `#ms <模型>` | 管理员 | 切换聊天模型 |
| `#pchat <bool>` / `#toolout <bool>` | 管理员 | 开关主动聊天 / 工具调用播报 |
| `#do-yes <id...>` / `#do-no <id...>` / `#do-pending` | 管理员 | 确认 / 拒绝（可一次多个编号）/ 列出待确认操作；拒绝会写回对话上下文 |
| `#bind` / `#unbind` / `#bindlist` | 管理员 | 把当前会话加入 / 移出白名单、查看白名单（`#bind` 在未授权会话中同样可用） |

---

## 项目结构

```
core/
├── index.js                    # 入口：初始化 MCP → 启动 WS 服务（QQ/微信）→ 启动面板 API
├── config.js                   # 默认值层（随仓库分发）+ Proxy 热改落盘
├── config.json                 # 用户配置层（gitignore，覆盖 config.js 的默认值）
│
├── bot/                        # 通信层：Server 接收并格式化信息，Adapter 处理对外的动作
│   ├── servers/                # BaseServer 抽象基类（toSegments 归一化 + dispatch）+ Onebot / WechatBot 实现
│   └── adapters/               # BaseAdapter 抽象基类（sendMsg 对外发送）+ Onebot / WechatBot 实现
│
├── pipeline/                   # 事件处理管道
│   ├── index.js                # 管道编排：中间件 → 处理器
│   ├── context.ts              # 上下文构建与目标过滤
│   ├── agent-runner.ts         # Agent 事件 → 适配器分发（节流发送）
│   ├── middleware/             # image-recognizer（图片识别）
│   └── handlers/               # user-commands / ai-chat / proactive-chat
│
├── agent/                      # Agent 核心（AI 相关代码全部内聚于此）
│   ├── Agent.ts                # 循环主体，只产出事件不碰通道
│   ├── plan.ts                 # 任务计划存储与渲染（PlanBoard）
│   ├── AgentManager.ts         # 会话池：空闲回收 / 数量上限
│   ├── contextBuilder.ts       # LLM 请求上下文组装
│   ├── replyParser.ts          # 模型回复解析：{action:[...]} → 统一消息段
│   ├── client.js               # LLM API 客户端（文本 / 视觉）
│   ├── tools.js                # 工具定义、调度与路径门禁
│   ├── tools/                  # 细粒度工具模块（一个工具一个文件）
│   ├── tool-approval.js        # 危险操作确认队列
│   ├── approval-runner.ts      # 危险操作确认执行链
│   ├── mcp-manager.js          # MCP 连接管理 + 工具命名/路由
│   ├── skill.js                # Skill 加载器
│   ├── image.js                # 视觉 API
│   ├── long-term-memory.js     # 长期记忆封装（rememori 语义读写）
│   └── recorder.js             # 分层记忆记录器（短期消息 / 中期概括 + 体积阈值守护）
│
├── api/                        # Web 面板 API（独立 WS 服务端：鉴权/心跳/白名单/事件总线）
├── services/                   # 适配器注册表 / NapCat HTTP / 定时调度 / 苏醒触发 / 启动自检 / 记忆存储
├── stickers/                   # 表情包库（index.js 提供全量列表：画面描述 + 文件路径 + manifest.json + images/）
├── types/                      # 跨模块共用类型（Context / CtxEvent / MessageSegment / Space 等）
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

在 `agent/tools/` 下新建一个工具模块（导出 `definition` 供模型、`execute` 为实现），再到 `agent/tools.js` 的 `toolRegistry` 中登记，新工具会自动出现在 AI 的可用工具列表中。需要门禁的工具在 `callTool()` 里按工具名加审查分支。

### 添加 MCP Server

`core/config.js` 已自带一个 `websearch` 项（open-websearch，多引擎搜索 + 网页正文抓取，无需任何凭据）。`mcpServers` 是配置里唯一**按 `name` 增量合并**的数组：

- 只写自己要加的项即可，新 `name` 追加到默认项之后；
- 与默认项同 `name` 时代替整项（不是逐字段合并，`env` 要写全）；
- 不想用某个默认项，写 `{ "name": "websearch", "disabled": true }` 即可剔除；
- 你写的项保持你写的先后顺序。

在 `core/config.json` 的 `mcpServers` 中添加（`command` 写 `"$NODE"` 直接用当前运行的 node，避免写死路径）：

```json
{
    "name": "github",
    "description": "GitHub 操作",
    "transport": "stdio",
    "command": "$NODE",
    "args": ["D:/path/to/mcp/github-server/index.js"]
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

- **命令审查门禁**：`run_shell` 经小模型三分类审查（`guard` 模式），`deny` / `unsure` / 未配置 guard 模型一律挂起等管理员确认
- **目录穿越防护**：`..` 等越出 `core/`（跑 dist 时为 `dist/`）的路径被 `file-security.js` 硬拦截
- **面板 API**：仅绑定 `127.0.0.1`、独立 token 鉴权、action 白名单分发、配置输出脱敏、全量 try/catch 故障隔离
- **OneBot 接入鉴权**：反向 WebSocket 在握手阶段校验 `Authorization: Bearer` / `?access_token=`（与 NapCat 复用同一 token，sha256 + 恒定时间比较），失败回 401 不进入连接回调，并按来源 IP 记告警

---

## License

[MIT](LICENSE)
