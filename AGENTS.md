# AGENTS.md

本文件为 AI 编码代理（及新加入的开发者）提供本仓库的工作指南。

**Cith / SunbatwoBot** 是一个跑在自建设备上的个人 Agent，住在 QQ（OneBot v11 / NapCat）与微信里，另配一个 Web 管理面板与一个 Electron 桌面客户端。核心是一个多轮工具调用的 LLM Agent 循环，配分层记忆与 SKILL.md 技能系统。

- Node.js **>= 24**：依赖原生 type stripping 直接运行 `.ts`；全仓 ESM（`"type": "module"`）
- JS/TS 混合结构：`packages/core/` 中 TS 略多于 JS，逐步向 TS 迁移
- LLM 走 OpenAI 兼容协议，接入任意端点

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm start` | 直接运行 `packages/core/index.js`（Node 24 现场转译 TS，开发推荐，改完即生效） |
| `npm run build` | tsc 按 `tsconfig.build.json` 只转译不检查（`noCheck`）→ `dist/`，再由 `scripts/copy-assets.js` 拷贝非代码资源 |
| `npm run start:dist` | 运行构建产物 `dist/index.js`（部署用；需先 build） |
| `npm run build:web` | 编译 Web 面板（`packages/web/` 内 tsc -b + Vite → `packages/web/dist/`） |
| `npm run build:desktop` | 编译桌面客户端（`packages/desktop/` 内 tsc -b + electron-vite → `out/`；开发进 `packages/desktop/` 跑 `npm run dev`） |
| `npm run bundle:desktop` | 打带内置 core 的桌面安装包：`npm run build` → `scripts/stage-desktop-core.js` 装配 `core-bundle/`（排除密钥与运行数据，按生产依赖闭包复制 node_modules）→ electron-builder |
| `npm test` | `node --experimental-test-module-mocks --test "tests/**/*.test.mjs"` |
| `npm run setup` | 交互式初始化（写 `packages/core/config.json` 与 `packages/web/.env`；`--check` 只读检查 / `--no-start` / `--force`） |
| `npm run add-stickers` | 用视觉模型批量给表情包图片生成描述/标签，写入 sticker manifest |
| `bash update.sh` | 拉取更新 + 按需装依赖 + 编译（`--web` / `--stash` / `--force`；不会重启服务） |

- **没有 linter**，没有根级 `typecheck` 脚本。`tsconfig.json` 是 IDE 类型检查基准（strict + noEmit）；如需 CLI 检查手动跑 `node node_modules/typescript/lib/tsc.js -p tsconfig.json`。
- **测试现状（写作时）**：8 个测试文件、53 个用例，全绿 —— `adapter-registry`（通道路由）、`agent-abort`（中断语义）、`image-compress`、`memory-eviction`、`memory-time`、`notes-store`、`reply-tool`（发言工具 + 主循环）、`voice-segment`。测试只覆盖不依赖外部服务的纯逻辑与可 mock 的循环行为，不写“某个阈值取多少最优”这类随参数漂移的断言；失败时先弄清是“测试先行”还是“真实回归”，不要盲目改代码凑绿。
- 需要连接 NapCat（反向 WS，默认 `ws://127.0.0.1:8080/onebot/v11/ws`）才能真正收发消息；无 NapCat 时可只验证启动自检与面板 API。

## 配置系统

两层配置，`git pull` 永远不会覆盖用户配置：

- `packages/core/config.js` —— 默认值层，随仓库分发，可提交
- `packages/core/config.json` —— 用户配置层，**gitignored**（路径可用环境变量 `CITH_CONFIG` 指向仓库外）

合并规则：标量与数组整体覆盖；普通对象只覆盖写了的字段；`mcpServers` 是唯一**按 `name` 增量合并**的数组（同 `name` 整项代替；`{"name": ..., "disabled": true}` 剔除默认项）；`members` 写成 `{"QQ号": "昵称"}` 对象，加载时转 Map；`$` / `_` 开头的键是注释，加载时忽略；`command: "$NODE"` 重写为当前 node 可执行文件。解析失败直接中止启动，不静默降级。旧版大写键（`TOOLCHAIN_MAX_LENGTH` 等）自动迁移为新 camelCase 键。

运行期细节：`config` 被 Proxy 包裹，顶层键赋值自动读改写回 `config.json`（`members`/`mcpServers` 不落盘；密钥类键只警告需重启）。跑 `dist/` 时配置在 `dist/config.json`，`npm run build` 会用 `packages/core/config.json` 覆盖它。

**数据根与数据目录**：数据（data/）、提示词（prompts/）、技能（skills/）、表情包（stickers/）与 run_shell 的 cwd 全部锚在 `utils/file-security.js` 的 baseDir 上（默认= 包目录自身）；设 `CITH_DATA` 环境变量可把整个数据根搬到包外——桌面客户端内置 core 即用它把可变数据落进 userData（config.json 仍走 `CITH_CONFIG`，两者独立）。`enableOnebot` / `enableWechat` 开关控制 QQ / 微信接入服务是否启动（默认开；微信无凭证会无限重试登录，内置 core 的本地模式按需关）。

**系统提示词不是配置项**：固定路径 `packages/core/prompts/system.md`，每轮重读，改完即生效；缺失时不注入任何 system 消息。面板通过 prompt 接口写入（带 `.bak` 备份），`set_config` 刻意无法触碰它。

## 架构

### 事件管道

**设计模式：Server 接收并格式化信息，Adapter 处理对外的动作。**

```
NapCat(反向WS) / 微信(长轮询) / 桌面客户端(自开WS, DesktopServer)
  → bot/servers/*（BaseServer 子类）                    连接生命周期；toSegments 收到消息时归一化为统一段（图片就地落地写 media.localPath，语音转码落 mp3 + 附 QQ 原生转写），toEventMeta 出会话/发送者元信息，dispatch 统一装配 CtxEvent
  → pipeline/context.ts buildContext                   构建 ctx + 目标过滤
  → pipeline/index.js                                  处理器
  ← bot/adapters/*（BaseAdapter 子类）                 对外动作：仅 sendMsg() 发送
```

- `ctx` 字段：`{ adapter, messageId, message(统一消息段数组), space{from,id,channel,conversationId?}, senderName, userId, isAdmin, isTarget, handled }`。@、图片、链接等一律从 `ctx.message` 消息段取。`conversationId` 只在通道内部再分会话时出现（当前仅桌面端）：会话 id 为 `from:id`，带它时变为 `from:id#conversationId`；`space.id` 始终是用户/群本体，白名单与管理员判定都按它。
- 目标过滤：`targetGroupId` / `targetUserId` 均为**数组白名单**，空数组视为全放行；未授权会话中管理员发 `#bind` 可放行（bootstrap）。
- 处理器（**首个返回 true 即停止**）：`user-commands`（`#` 命令真表）→ `ai-chat` → `proactive-chat`。加新行为 = 插入处理器，不改管道循环。
- 图片是**懒识别**：消息里的图片段只带 `media.localPath` 进上下文，不自动调视觉模型；模型需要看图时用 `recognize_image` 工具按需识别（工具内做魔数校验，仅 jpg/png/webp）。送模型前会先过 `utils/image-compress.ts`：最长边超 1568px 或体积超 1.5MB 才等比缩小/重编码（png 保透明、jpg quality 85），小图与 webp（jimp 不解码）原样发送，解码失败也回退原图。
- 语音是**收到即处理**：`record` 段并行调 NapCat 的两个 action 后归一化为 `voice` 段——`get_record`（`out_format` 必填，默认 `mp3`）取音频、优先用返回的 `base64` 写进 `packages/core/data/voices/`（NapCat 跑在容器/另一台机时它的本机路径读不到），`fetch_ptt_text` 取 QQ 客户端自带的转写文本放在 `data.text`。两者任一失败只降级，段本身照进上下文；转写会拖慢 `toSegments` 1~3 秒。

### Agent 循环（`agent/Agent.ts`）

`Agent` 是 EventEmitter，每会话一实例，由 `AgentManager` 池管理（空闲 24 小时回收、上限 50）。**Agent 只"想"不"说"**：只广播 `reply` / `tool-call` / `tool-result` / `approval` 等事件，`pipeline/agent-runner.ts` 订阅后经适配器按拟人节奏发送。同一会话同时只允许一个模型请求。

每轮流程：`Agent.buildMessages` 组装上下文（系统提示 + 技能列表 + 扩展来源目录 + 全局笔记 + 记忆概要 + 历史 + 尾部易变项：活跃计划/唤醒说明）→ 带全量工具定义调 LLM → 同轮多个工具调用**并行执行** → 结果以 `role:"system"` 消息回填 → 再请求。最多 `toolChainMaxLength`（30）轮；达到上限后补发一次**只带发言工具**的请求强制收敛。**发言是工具调用，不是文本格式**：每轮工具表首位是由适配器能力集生成的 `send_message`（`bot/adapters/reply-tool.ts`），词表由适配器声明（OneBot 为 text / image / file / voice / mention / reply，微信没有 voice / mention / reply；表情包不设独立段：`list_stickers` 工具返回画面描述+文件路径，模型挑好直接走 image 段），与接收方向统一段同构。发言调用成功即交付消息（若本轮还有其它工具，则当场发出后继续循环，直到只剩发言或没有工具）；传空数组表示**本轮不发言**；模型不调用任何工具时正文为空才算不发言，正文有内容则回填 system 纠偏痕迹后重试一次，仍以纯文本作答就桥接成 text 段按正常发言投递（收敛轮不重试、直接桥接；正常路径依然没有纯文本通道，旧 `replyParser.ts` 已删除）。agent-runner 按段顺序逐个发送，reply/mention 攒到下一个内容段合并为一条（OneBot 语义）；平台不支持的段类型由 Adapter 自行跳过（微信不支持 mention/reply），字段翻译与纠错（如本地路径被填进 `uri`）也在适配器侧由 `utils/segment-media.ts` 完成。

技能目录在**每次 `Agent.run()` 开头重扫**，没有 `#reloadskls` 命令。计划状态在 `agent/plan.ts` 的 `PlanBoard`（Agent 只持有引用，`#plan` 命令与 `Agent.buildMessages` 共用同一份存储与渲染逻辑）。

### 工具（`agent/tools.js` + `agent/tools/`）

一个工具一个模块，导出 `definition`（给模型）与 `execute`（实现），在 `agent/tools.js` 的 `toolRegistry` 登记；`callTool()` 是唯一入口。**扩展工具不进常驻工具表**：`agent/extensions/registry.ts` 纳管扩展来源（`ExtensionProvider`：init / shutdown / overview / search / get / invoke），常驻工具 `search_tools`（发现，返回含参数格式的工具卡）与 `use_tool`（调用）对接注册表；MCP 是第一个来源，经 `agent/extensions/mcp-provider.ts` 包装 `agent/extensions/mcp-manager.ts`（stdio / old_sse / sse）接入，`index.js` 启停统一走 `extensionRegistry.init()/shutdown()`；各来源目录（服务器名 + 描述 + 工具数）由 Agent 在每轮 `run()` 开头从注册表现取并固定注入上下文，模型不用猜有哪些来源——Agent 依然只认注册表，不知道 MCP 存在。旧激活列表工具 `tools/manage-mcp.ts` 已删除，`McpClientManager` 的激活/去激活方法也已移除。`send_message` 负责所有对外输出，长任务的过程汇报也是它（与其它工具同轮调用时当场发出），没有独立的进度播报工具。

### 审批门禁（不可绕过）

- `utils/file-security.js` 的 `resolveSrcPath` 把相对路径解析钉死在 `packages/core/`（跑 dist 时为 `dist/`）内，`..` 穿越**硬拒绝**，供内部服务与 `run_shell` 的 cwd 解析使用。
- `run_shell` 门禁集中在 `callTool()`：已确认调用直通；**非管理员任何模式都审查**，管理员仅 `shellGate: "guard"`（默认）审查、`"open"` 直通——审查经小模型三分类（`agent/shell-guard.ts`，无状态、无会话上下文，guard 端点/密钥缺省回落 `llmApiUrl`/`aiApiKey`），`allow` 放行，`deny` / `unsure` / 未配置 `guardModel` / 调用失败一律挂起（10 分钟超时），等管理员 `#do-yes <id>` / `#do-no` / `#do-pending`，确认执行链在 `agent/approval-runner.ts`。挂起时 `callTool()` 返回 `ToolHold` 而非文本：Agent 主循环当场中断、挂起信息不写进对话记忆也不回给模型，`agent-runner` 收到 Agent 的 `approval` 事件后构造只对适配器可见的 `tool_approval` 消息段（文本渲染在 `utils/approval-notice.ts`），由 Adapter 发消息请求确认。`#do-yes` / `#do-no` 均可带多个编号；确认执行的结果用 `recordToolCall` 写回，拒绝用 `recordToolDenial` 写回（模型知道该操作未运行、不要重试）。
- 文件操作类工具（read_file / list_files / create_file / edit_file / delete_file / run_JS）已按 Issue #42 退役，文件与脚本操作统一走 `run_shell`。

### 记忆系统（`agent/recorder.js` + `agent/long-term-memory.js` + `services/memory-store.ts`）

按"预估 token 体积"守护而非消息条数（`CHARS_PER_TOKEN = 2.5`）：

- **短期**：会话消息，超过 `chatSummaryThresholdTokens`（12000）→ 一轮 run 结束后**后台静默摘要**（不阻塞下一轮）；事实抽取按 `KEEP_TAIL_RATIO = 0.3` 保留最新尾部，一条事实一条记忆写入 rememori。摘要提示词（`recorder.js` 的 `SUMMARY_PROMPT`）交代输入是带序号的结构化 JSON 消息（user 的 name/id/time/message 段、assistant 的 action、system 的工具痕迹），要求事实以第一人称「我」自述（概要下一轮会被模型自己读回）、对方用 name/id 指名、相对时间换算成具体日期；消息按 500 字符截断送入，提示词已声明残缺处不要臆测。
- **中期**：滚动保留最近 `MAX_SUMMARY_FACTS = 60` 条事实（`#sm` 查看）。
- **长期**：`services/memory-store.ts` 每进程只打开一次 rememori 文件；embedding 由 `memoryEmbedProvider` 选 `ollama`（本地）或 `openai`（任意兼容 `/embeddings` 端点）。**无 tag，全会话共享**；模型经 `get_memory` 工具检索（`queries` 最多 5 个，缺省从近期消息自动派生）。还有容量淘汰（`memory-eviction.ts`）与定期维护修剪。
- **工作预算**：`compactIfNeeded(contextBudgetTokens = 24000)` 在每次请求前把最旧的 system 工具痕迹折叠成 `[已折叠]…` 摘要（纯内存、幂等、不动 user/assistant 消息——模型可重新调用工具找回内容）。

⚠️ rememori **没有文件锁**：绝不要从第二个进程打开同一个 `.mem` 文件。切换 embedding provider/model 会使已存向量全部失效（删 `.mem` 重建）。

### 面板 API 与 Web 面板

- `packages/core/api/`：独立 WS 服务（默认 `ws://127.0.0.1:2145/api/v1/ws`，token 鉴权、心跳、action 白名单路由 `router.ts`、事件总线/环形日志缓冲）。各动件在 `api/actions/`；`shutdown` 动作触发主循环 cleanup 优雅退出（桌面客户端停止内置 core 用；不进 web BFF 的转发白名单）。
- **npm workspaces**：根 `package.json` 声明 `workspaces: ["packages/*"]`，统一 lockfile、依赖提升到根 `node_modules`；`packages/core/` 是 `@cith/core` 子包（运行依赖在其 package.json），`packages/ui/` 是 `@cith/ui`（共享 UI 组件源码直出、无构建步骤，消费端 Vite 负责编译；品牌色内联不挂主题变量），根上只留编排脚本与 TypeScript。`.npmrc`（Electron / electron-builder 镜像）在根。跨包脚本用 `npm run xxx -w packages/web`（-w 收路径，包名亦可）。
- `packages/web/`：workspace 子包——React 18 + TS + Vite 前端 + Express BFF（`packages/web/server/index.mjs`，:2146，持 `BOT_API_TOKEN`，可选 `WEB_PASSWORD` 登录与自签 HTTPS，SSE `/api/events`）。开发在 `packages/web/` 内 `npm run dev` + `npm run server`；详见 `packages/web/README.md`。
- `packages/desktop/`：workspace 子包——Electron 桌面客户端（electron-vite：main/preload/renderer 三段，React 18 + TS 渲染层，全 ESM；electron 依赖钉精确版本）。与 core 的消息通道完全解耦，仅经 WS 协议通信（占位协议已接通：消息帧带 `conversationId` + `abort` 中断帧，中断直通 `AgentManager.abortSession()`）；桌面端每条对话在后端是独立会话（`Space.conversationId`，会话 id 为 `user:<userId>#<conversationId>`）；另支持**内置本地 core 模式**——extraResources 携带 `core-bundle/`（装配脚本排除密钥与数据），主进程以 `ELECTRON_RUN_AS_NODE` 子进程拉起，配置与数据经 `CITH_CONFIG` / `CITH_DATA` 落 `userData/core/`，GUI 内配置、启停、看日志；工程级指南见 `packages/desktop/AGENTS.md`；设置页全部分类已落地（开机自启 / 发送快捷键 / 本地保留条数 / 系统通知均落到真实行为，无占位项）。

## 开发约定

- **注释、日志、系统提示词全部中文**，新代码保持一致。
- 用 `utils/logger.js`，不要用 `console`。
- **JS 引用 TS 模块时 import 路径显式写 `.ts` 后缀**（构建时 `rewriteRelativeImportExtensions` 自动重写为 `.js`）；导入 interface **必须 `import type`**；JS 文件中用 JSDoc 引用类型：`/** @typedef {import("./xxx.ts").Type} Type */`。
- `.ts` 中只允许可擦除语法（`erasableSyntaxOnly`：禁 `enum` 等）。
- 共享类型单一真源：跨模块接口进 `packages/core/types/index.ts`（`CtxEvent` / `Space` / `Context`），消息段类型在 `packages/core/types/segment.ts`；Agent 专属类型（`ToolCall` / `LlmResult` / `ToolContext` / `ReplyOutcome` / `AgentRunResult` 等）进 `agent/types.ts`，按「对话与模型交互 / 工具 / 主循环产出 / 计划 / 长期记忆」分块——不要在别处重复定义。工具入参类型（`XxxParams`）跟着各自工具模块走，字段一律写 `unknown`（来自模型生成的 JSON，执行时自行归一化）。types 与 `BaseAdapter` 之间的 type-only 循环 import 是允许的（运行时擦除）。
- 传输相关状态（如 ws socket）留在具体 Adapter 子类，不进 `BaseAdapter`。
- 上下文组装讲究**前缀缓存友好**：稳定内容在前、易变内容在后；改动时勿打乱这一顺序。
- 每轮请求的固定底噪主要来自 `system.md`、技能清单与工具定义（`send_message` 单个 ≈ 940 token）：改工具 schema/描述时先想清楚这会让每轮成本涨多少。

## 如何扩展

- **加用户命令**：`pipeline/handlers/user-commands.js` 的 `cmds` 数组加一项（`name` / `description` / `needsAdmin` / `params` / `handler`）。
- **加关键词匹配**：没有独立的关键词命令框架，直接写在 `user-commands.js` 的 handler 里判断文本。
- **加工具**：`agent/tools/` 下新建模块 → 在 `toolRegistry` 登记；需要门禁的工具在 `callTool()` 里按工具名加分支。
- **加扩展工具来源**：`agent/extensions/` 下实现 `ExtensionProvider`（发现 / 调用 / 生命周期）→ `registry.ts` 登记；其工具定义不进工具表，模型经 `search_tools` / `use_tool` 动态发现与调用。
- **加 MCP Server**：写进 `packages/core/config.json` 的 `mcpServers`（按 `name` 增量合并规则，见上）。默认自带 `websearch`（open-websearch，无需凭据）；其工具不进工具表，模型经固定注入的来源目录感知存在，经 `search_tools` / `use_tool` 发现与调用。
- **加聊天平台**：`bot/servers/` 加一个 `BaseServer` 子类（实现 `toSegments` 把平台消息归一化为统一段、`toEventMeta` 出元信息，媒体在 `toSegments` 内就地落地）+ `bot/adapters/` 加一个 `BaseAdapter` 子类（实现 `sendMsg()` 对外发送、声明 `channel` 与 `replyCapabilities()`），并在 `services/adapter-registry.js` 注册；管道与处理器零改动。
- **加技能**：`packages/core/skills/<名称>/SKILL.md`（frontmatter `name`、`description`）+ `scripts/` 下 JS 脚本（`process.argv[2]` 收 JSON 参数、`console.log` 出结果，经 `run_shell` 执行）。社区技能经内置 `skills/skill-manager/` 从 GitHub 安装；强加载机制（frontmatter `force` + 正文注入）已删除，SKILL.md 正文不进上下文。

## 仓库注意

- gitignored 的本地路径：`packages/core/config.json`、`packages/core/app.pem`、`mcp/`（本地 MCP server，如 `mcp/github-server`）、`packages/core/data/rememori/`（长期记忆）、`packages/core/data/images/`（微信图片落地缓存）、`packages/core/data/voices/`（QQ 语音转码落地）、`packages/core/data/wechatbot*/`（微信登录凭证）、`packages/core/stickers/manifest.dev.json`、`packages/core/prompts/*.bak`、`packages/web/.env`、`dist/`。sticker manifest 有 `manifest.example.json` 模板。