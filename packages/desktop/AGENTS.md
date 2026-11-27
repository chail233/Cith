# AGENTS.md（desktop）

本文件为 AI 编码代理与开发者提供桌面客户端（`packages/desktop/`）的工作指南。仓库级指南见根目录 [AGENTS.md](../AGENTS.md)；面向使用者的简介见 [README.md](README.md)。

## 定位

- Cith 的桌面客户端：Electron + React 18 + TS + electron-vite，workspace 子包（`packages/desktop/`，根 `workspaces: ["packages/*"]`，统一 lockfile），消息通道**与 core 完全解耦**，仅经 WS 协议通信（占位协议已接通，详见下文「协议」）；另支持**本地内置 core 模式**——主进程管理一个 core 子进程，消息通道仍走同一 WS 协议，见下文「本地内置核心」
- 桌面端只承接**桌面频道**：不做跨平台收件箱，不消费 QQ / 微信的会话数据
- 状态边界：core 拥有全部权威状态（会话、记忆、审批），desktop 只拥有表现层；本地存储（localStorage）只放 UI 偏好，不做第二真源

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | Electron 开发模式（main/preload 走 esbuild 秒编译改完即重启，renderer 走 Vite HMR 不重启窗口） |
| `npm run dev:web` | 只在浏览器跑渲染层（:5199），用于视觉调试与截图自批；此时 `window.desktop` 不存在，访问它的代码必须可选链兜底 |
| `npm run build` | `tsc -b` 类型检查 + electron-vite 编译 → `out/` |
| `npm run typecheck` | 只做类型检查（tsconfig.node / tsconfig.web 两个子项目） |
| `npm run preview` | 运行 `out/` 编译产物 |
| `npm run dist` | 打包分发产物 → `release/`（NSIS 安装包 + portable 单文件，先 build 再 electron-builder） |
| `npm run dist:dir` | 只出未打包目录（`release/win-unpacked/`），调试打包结果用 |
| `npm run bundle:desktop`（仓库根） | 打**带内置 core** 的安装包：根 build → 装配 `core-bundle/` → electron-builder；不含 `dist/` 时 dev 模式内置核心不可启动 |

## 进程模型（Electron 三段）

- `src/main/` —— 主进程（Node 环境，每个 App 一个）：窗口生命周期、IPC handler。**后端 WS 客户端在 `backend.ts`**——主进程不随窗口关闭而死，常驻连接是托盘 / 系统通知的前提；`settings.ts` 持久化用户设置（userData/settings.json，懒加载懒创建）；`sessions.ts` 会话快照读写与清空；`files.ts` 文件对话框与落盘（选取/保存/打开链接）；`local-config.ts` 与 `local-core.ts` 管内置本地 core（见「本地内置核心」）。**设置的副作用只在主进程生效**：`index.ts` 的 `applyLoginItem()` 管开机自启（保存时与启动时各对齐一次），`showReplyNotice()` 管系统通知（读设置 + `BrowserWindow.getFocusedWindow()` 双重判定）
- `src/preload/` —— 预加载桥：`api.ts` 定义 `desktopApi`（单一真源），经 `contextBridge` 暴露为 `window.desktop`，类型通过 `index.d.ts` 给渲染层。**能力收口**：渲染层永远不直接碰 Node，新能力逐个显式加进 `desktopApi`
- `src/renderer/` —— React 界面（结构与数据流见下）

安全基线：`contextIsolation: true`（默认开）+ `nodeIntegration: false`（默认关）+ `sandbox: false`（ESM 格式 preload 的硬性要求，不影响 contextBridge 隔离）。CSP 写在 `src/renderer/index.html` 的 meta 里。

## 渲染层结构

```
src/renderer/src/
├── types.ts                  域类型单一真源：Conversation / ChatMessage / Segment（协议段 {type,data}）/ TraceData
├── settings.ts               UI 设置应用：apply 写 CSS 变量到根节点；类型与默认值在 src/shared/settings.ts，持久化在主进程
├── useConversations.ts       会话状态缝：列表 / 归档组 / 激活会话 + 全部增删改 + 本机落盘
├── sessionSnapshot.ts        快照净化：落盘前裁掉超限附件，读回时逐段校验
├── useBackendChat.ts         消息通道会话桥：出站装帧、入站转段进会话（按回传的 conversationId 归属 + pending 兜底）
├── styles/
│   ├── tokens.css            设计 token 单一真源（色板 / 圆角 / 缓动 / 可调变量）
│   └── base.css              reset + 滚动条 + .app 骨架 + 跨组件共享动画帧（rise / view-in / breathe）
└── components/
    ├── Sidebar.tsx/.css      会话列表 + 悬停 ⋯ 菜单（归档/删除，靠底自动上翻）+ 已归档分组 + 品牌行连接状态点 + 右缘拖拽调宽（双击复位）+ 底部「设置 / 本地核心」入口
    ├── Chat.tsx/.css         视图编排：头部 / 消息列表（自动滚底）/ 思考点 / 空状态
    ├── Message.tsx/.css      段渲染器：文本段拆段落 + 行内 code；image 段气泡内图片；voice 段与音频文件可点播；file 段文件卡（保存 / 打开链接）；trace 段转交 ToolTrace
    ├── ToolTrace.tsx/.css    工具痕迹卡片（签名组件，grid-rows 平滑展开终端输出）
    ├── Composer.tsx/.css     自适应高度输入框（键位随 sendKey 设置：Enter 发送 / Shift+Enter 换行，或 Ctrl+Enter 发送 / Enter 换行）+ 附件入口（图片 / 文件）与待发附件条；等回复期间右侧额外多一个中断键，输入与发送都不锁
    ├── Settings.tsx/.css     设置弹窗（全屏遮罩 + 居中面板，Esc / 遮罩 / × 关闭）：分类导航 + 界面滑组 + 通用（开机自启 / 发送快捷键）+ 会话（保留条数 / 打开数据目录 / 清空本地记录）+ 通知（系统通知开关）+ 用户（频道身份）+ 后端连接（地址 / token / 连接状态，状态文案与侧栏共用）+ 实时预览；行组件的样式类都挂在这份 css（全局类，LocalCore 复用）
    ├── LocalCore.tsx/.css    本地核心独立界面（侧栏入口，全屏遮罩 + 横向三页）：运行（消息通道切换 / 随启动 / 状态 / 启停动作 / 微信扫码卡，开关即时落设置）+ 配置（config.json 全量键表单，左侧分组导航——OneBot / 微信 / 桌面 / 面板 / 身份 / 模型 / 对话 / 记忆 / 外部，字段由 CFG_GROUPS 声明式驱动，保存做差量只写改动键）+ 日志（终端盒撑满）
    ├── rows.tsx              设置与本地核心共用的行组件：`SliderRow` / `SwitchRow` / `OptionRow` / `ActionRow`（danger 需点两次，4s 自动复位）/ `FieldRow`
    ├── BrandMark.tsx/.css    品牌标组件：徽章双色调（C 罩 + ith 焰心）；`orbit` 变体即加载态（C 沿 ith 公转）；侧栏 / 空态 / 关于 / 思考指示共用
    └── icons.tsx             手写 SVG，不引图标库
```

**数据流**（一次发送的旅程）：Composer `onSend(text, extras)`（extras 为附件段）→ `App.handleSend`（须已连接）→ `chat.send()` 装帧发出（用户消息已在缝内建段）→ 入站帧经 `useBackendChat` 转段、按归属映射落会话 → React 重渲染 → `Message` / `ToolTrace`。

**数据源缝在 `useBackendChat`**：协议侧数据从这里进出，组件层零感知。组件内不直接操作会话数据，一律走 hook 方法。

## 约定

- 注释一律中文；类型导入必须 `import type`
- 颜色 / 圆角 / 缓动不写魔法值，进 `tokens.css`；组件私有样式与组件同名同目录，跨组件的动画帧进 `styles/base.css`；**不画边框线**，分层靠表面色阶和软阴影（用户审美红线：冷色、线条堆结构）
- **视觉纪律（去 AI 味，用户红线）**：禁发光（任何彩色 box-shadow halo）、禁弹簧过冲（`--ease-spring` 已删，一律 `--ease`）、禁 blur 入场；动效只回应操作（`--speed` 180ms），进场帧全站只有 `rise` / `view-in`，不做 stagger；状态点一律实色无光环；琥珀只用于品牌标（BrandMark 徽章）、主发送按钮、range 轨道与 active 标记（菱形仅作列表标记语言）；Space Grotesk 仅品牌标使用；思考指示是品牌标公转（`orbit`），不是三点弹跳
- 加消息段类型：`types.ts` 加类型 → `Message.tsx` 加分支 → 必要时新组件一个
- 加界面设置项：`shared/settings.ts` 加字段（类型 + 默认值 + `mergeSettings` 校验）→ `settings.ts` 的 apply 写变量（仅视觉类需要）→ `components/rows.tsx` 挑合适的行组件（`SliderRow` 滑块 / `SwitchRow` 开关 / `OptionRow` 分段 / `ActionRow` 按钮）→ CSS 里用 `var(--xxx)` 做作用点。**非视觉项（如开机自启、系统通知）不加 apply，改在主进程读设置时生效**
- 加 `window.desktop` 能力：`preload/api.ts` 加方法 + `index.d.ts` 类型自动跟随，渲染层可选链调用；需要主进程做事的（系统级副作用、文件操作）走 IPC handler，不要塞进渲染层
- 每轮请求 UI 改动后：`npm run typecheck` + `npm run build`，视觉改动用 `dev:web` 截图自查（改动后导航要带时间戳参数穿透缓存）

## 协议（占位已接通）

- core 侧 `DesktopServer` 已落地（`desktopPort`，默认 2147；token 与 NapCat 共用，握手阶段校验 `Authorization: Bearer`）；审批桥（`#do-yes` 按钮化）仍走 core/api（2145）的 action
- 占位帧契约（正式协议定型后替换）：出站 `{type:'message', messageId, userId, conversationId, segments}`，入站 `{type:'message', space:{from,id,conversationId?}, segments}`，段一律 `{type, data}` 统一段直传；帧类型单一真源在 `preload/api.ts`
- **会话粒度**：`conversationId` 是桌面端每条对话的 id，core 侧 `DesktopServer` 把它放上 `space.conversationId`，会话 id 变成 `user:<userId>#<conversationId>`——每条对话一份 Agent、一份短期记忆；`space.id` 仍是用户身份，故 `targetUserId` / `owner` 判定不受影响
- **连接客户端**：`src/main/backend.ts` 常驻持有传输层（Bearer 握手、自动指数重连、建连超时兜底、入站帧经 `backend:message` 广播给渲染层）；地址 / token 在设置页「后端连接」配置并实时经 `desktopApi.setBackend` 下发
- **中断**：等回复期间发送键左侧多一个方块中断键（输入与发送都不锁，连发即可——新消息进记忆后正在跑的那轮循环下一轮请求就会带上），客户端发 `{type:'abort', userId, conversationId}` 帧（不走消息管道），目标取「正在等回复的那条对话」；core 侧 `DesktopServer` 按 `toEventMeta` 推出会话后直接调 `abortSession()`，只查不建——不产生用户消息、不进模型记忆，被中断的轮次也不会再推送回复，所以思考指示当场收掉
- **会话桥**：`useBackendChat` 装帧/收帧；agent 回复按段拆帧连发（段间 3~4s 拟人间隔），客户端逐帧追加即保节奏；**归属按帧里回传的 `space.conversationId` 直接落回对话**，没带时（主动消息 / 旧后端）才回落到「最近一次发送的对话 → 当前对话」；第一帧收掉思考指示；发送不做互斥（会话内并发请求由 core 的 Agent 自己处理）；桌面频道身份 `userId` 在「用户」设置页可配（缺省 `desktop`，留空回退），随消息帧发送到后端并决定管理员/白名单判定
- **段建模**：出站段在 `useConversations.sendOutgoing` 缝内构建（text + Composer 传来的 image/file 附件段），返回值直接装帧、不做二次转换；trace 是桌面本地展示段，由工具事件生成
- **工具事件**：Core 用 JSON 帧发送 `tool.start` / `tool.end`，包含 `space: { id, conversationId }`、`executionId`、`toolCallId`、`toolName`、`startedAt`，结束帧还带 `status`、`durationMs` 和 `output`。主进程经 `backend:tool-event` 转发，渲染层按身份、对话和执行 ID 更新卡片。相邻调用默认收在「调用了工具」入口，展开后逐行显示状态，再展开单行查看详细结果。工具记录随会话落盘，断连或重开时缺少结束帧的卡片显示「未收到结果」
- **媒体段**：Core 发送的本地媒体和桌面上传的非图片附件走 WS 二进制消息，依次包含 4 字节大端 JSON 头部长度、UTF-8 JSON 头部和按段顺序拼接的原始媒体字节。头部的 `data.binaryLength` 标明每段字节数。桌面文件选择、保存和 IPC 使用 `ArrayBuffer`，上传图片只在 WS 主进程边界编码为 `data.base64`，同帧有其他附件时放在 JSON 头部。http(s) 引用直接透传。上传后由 `DesktopServer` 落地到 `data/desktop/` 并改写为 `media.localPath`。单个本地媒体的体积上限为 Core 发送 50 MiB、客户端上传 25 MiB
- 待办：正式协议握手版本号与 `chat.*` 事件集、审批卡片事件、跨端历史同步
- **设置项已全部开放**（无占位分类），每一项都落到真实行为：`startAtLogin` → 主进程 `app.setLoginItemSettings`；`sendKey` → `Composer` 的键位与提示文案；`historyLimit` → `snapshotOf` 存盘截断（60~600，`HISTORY_LIMIT_MIN/MAX` 单一真源在 `shared/settings.ts`）；`notifyOnReply` → 主进程 `Notification`。其余为视觉项（`theme` 主题 → 根节点 `[data-theme]` + 主进程窗口底色；字号 / 行高 / 段间距 / 消息间距 / 内容宽度；侧栏宽度 `sidebarWidth` → `--sidebar-width`，侧栏右缘拖拽实时调、松手落同一设置）与后端连接（地址 / token）、频道身份（`userId`）

## 本地内置核心

侧栏底部「本地核心」入口打开的独立管理界面（运行 / 配置 / 日志横向三页）：客户端可以自带一个编译好的 core 在本机跑，GUI 完成配置、启停、看日志；`coreMode: 'remote' | 'local'`（`shared/settings.ts`）决定消息通道指向，默认 remote 行为不变；运行页的消息通道与随启动开关改动即时经 `settings:save` 落盘。

- **进程**：`src/main/local-core.ts` 的 `LocalCoreManager` 用 `spawn(process.execPath, [core入口], { ELECTRON_RUN_AS_NODE: '1' })` 复用 Electron 自带 Node 跑 `dist/` 产物（系统无需装 Node）；状态机 `stopped / starting / running / stopping / crashed`（稳定存活 1.5s 才报 running），stdio 按行收 2000 行环形缓冲，经 `core:status` / `core:log` 广播给渲染层；停止走面板 API `shutdown` 动作（Windows 的 `child.kill()` 是强杀，不走 core 的 SIGTERM 清理），4s 超时才强杀；app `before-quit` 有兜底停止
- **配置与数据**：`src/main/local-config.ts`（不 import electron，根 `tests/local-config.test.mjs` 直接测）管 `userData/core/` 布局——`ensureCoreData()` 首次播种 config.json（随机生成 `token` 与 `web.token`、`wechatStorageDir` 写绝对路径）并从 bundle 复制 prompts / skills / stickers（**幂等，存在即跳过**）；`saveCoreConfig()` 深合并 + 原子写（tmp+rename）。core 子进程以 `CITH_CONFIG=<userData>/core/config.json`、`CITH_DATA=<userData>/core` 启动（`CITH_DATA` 是 core 侧的包外数据根逃生口）
- **GUI 配置写文件而非走 set_config**：`core:config:get/save` 直接读写 config.json（save 后 core 在跑则提示「重启生效」）——统一覆盖所有键（含 `mcpServers` / `members` / 端口），单一写入路径，避免与 core 的 set_config 白名单两套语义并存
- **连接自动接线**：`coreMode === 'local'` 时主进程忽略渲染层推来的手填地址，改用 `ws://127.0.0.1:<desktopPort>` + `config.token` 自动连接（`index.ts` 的 `backend:apply` 覆盖 + core running 事件重推）；QQ / 微信通道由 core 配置的 `enableOnebot` / `enableWechat` 开关控制，微信首次登录在日志里捞 `WechatBot二维码: <url>` 行渲染成图（`qrcode` 依赖），扫码成功自动消失
- **打包**：根 `npm run bundle:desktop` → `scripts/stage-desktop-core.js` 把 `dist/` 装配进 `packages/desktop/core-bundle/`（排除 `config.json` / `data/` / `.wechatbot` / `workspace` / dev 表情清单，不把开发机密钥与运行残留打进安装包），并按 `@cith/core` 生产依赖闭包复制根 `node_modules`（内置 core 是独立 Node 进程，asar 里的依赖读不到；默认 websearch MCP 的 cwd 相对路径靠它），随后打成单 tar（`node_modules.tar` + 文件数 manifest）——NSIS 逐文件解压两万多个小文件太慢；electron-builder `extraResources` 落 `resources/core`，未安装 npm CLI 依赖、闭包纯靠逐包读 package.json 递归。`core-bundle/` gitignored
- **首启解压**：`src/main/node-modules-setup.ts`（不 import electron，根 `tests/node-modules-setup.test.mjs` 直接测）在拉起 core 前把 `node_modules.tar` 解回 `resources/core/node_modules`——先解到临时目录、文件数与 manifest 校验一致后原子换入，成功写 `.cith-setup.json` 版本标记；版本一致跳过，不一致（升级后）重解压；失败清理残留并保留 tar，`core:setup:retry` 可重试。`index.ts` 的 `startLocalCore()` 是唯一接线点（自动启动 / `core:start` / 重试都走它），解压进度与错误经 `core:setup` 广播，渲染层 `CoreSetupGate` 全屏展示加载与错误
- **已知边界**：打包模式不带 `mcp/` 本地 MCP（bilibili / github-server 需在 GUI 里填绝对路径）；技能脚本 `run_shell node xxx.js` 依赖系统 PATH 有 Node；单机同时跑两个 core 会撞 2145 / 2147 / 8080 端口（GUI 三个端口字段都可改）；`enableWechat` 开着且无凭证时会无限重试登录刷日志（GUI 可关）

## 本地落盘

- 会话快照走 `userData/sessions.bin`（主进程 `src/main/sessions.ts`）：渲染层去抖 500ms 写一次，`beforeunload` / `pagehide` 再单向补写一次；主进程用 V8 二进制序列化，先写 `.tmp` 再改名，超过 16 MiB 跳过本次写入
- 层级分工：`src/shared/session.ts` 只约定外层形状（`version` / `conversations` / `archived` / `activeId`），段级校验在渲染层 `sessionSnapshot.ts`——快照可能来自旧版本或被外部改坏，坏段整条丢弃
- 截断规则：会话各 200 条、单会话保留尾部 `historyLimit` 条消息（默认 400，设置页 60~600 可调；读回侧固定按上限 600 截断，调小设置后重启不会立刻丢更早的历史）。单个媒体段超过 1152 KiB 只留元信息，缺少链接的图片和音频显示「本地未缓存」。Core 的上传落地文件与桌面历史缓存独立保存
- 快照只是**本机缓存**：真源仍在 core 的记忆里，跨设备/跨端不共享；用 `conversationId` 与后端会话一一对应（定时苏醒任务也随 `space.conversationId` 落回原对话）；`dev:web` 无主进程时不落盘，只在内存里跑

## 已知坑

- Electron 二进制与 electron-builder 的 NSIS / winCodeSign 下载走 npmmirror（镜像键在**根** `.npmrc`，GitHub 直连会 `fetch failed`）；electron 依赖必须钉**精确版本**（无 `^`）——提升后 electron-builder 无法从范围版本解析平台二进制
- 打包：无应用图标（默认 Electron 图标，放 `build/icon.ico` 即换）；未签名，别的机器首启有 SmartScreen 提示；`release/` 已 gitignored
- ESM 产物命名：main 是 `.js`（靠 package.json 的 `type: module` 判定）、preload 是 `.mjs`（预加载无 package.json 上下文，靠扩展名自证）——`package.json#main` 与主进程里的 preload 路径必须与产物对齐
- `dev:web` 模式下 `localStorage` 与 Electron 正式环境同源策略不同（浏览器端口 5199），UI 设置两边不共享，属预期
- dev 模式内置核心指向仓库根 `dist/`（`resolveCorePaths`），**必须先 `npm run build`**，否则启动报入口不存在；打包态入口在 `resources/core/`
- core 的 skills / stickers 由 `ensureCoreData` 播种进 userData；手动删掉 `userData/core/` 会重置全部本地核心数据（含微信凭证），属「重置」语义而非 bug
