# AGENTS.md（desktop）

本文件为 AI 编码代理与开发者提供桌面客户端（`packages/desktop/`）的工作指南。仓库级指南见根目录 [AGENTS.md](../AGENTS.md)；面向使用者的简介见 [README.md](README.md)。

## 定位

- Cith 的桌面客户端：Electron + React 18 + TS + electron-vite，workspace 子包（`packages/desktop/`，根 `workspaces: ["packages/*"]`，统一 lockfile），**与 core 完全解耦**，仅经 WS 协议通信（占位协议已接通，详见下文「协议」）
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

## 进程模型（Electron 三段）

- `src/main/` —— 主进程（Node 环境，每个 App 一个）：窗口生命周期、IPC handler。**后端 WS 客户端在 `backend.ts`**——主进程不随窗口关闭而死，常驻连接是托盘 / 系统通知的前提；`settings.ts` 持久化用户设置（userData/settings.json，懒加载懒创建）；`files.ts` 文件对话框与落盘（选取/保存/打开链接）
- `src/preload/` —— 预加载桥：`api.ts` 定义 `desktopApi`（单一真源），经 `contextBridge` 暴露为 `window.desktop`，类型通过 `index.d.ts` 给渲染层。**能力收口**：渲染层永远不直接碰 Node，新能力逐个显式加进 `desktopApi`
- `src/renderer/` —— React 界面（结构与数据流见下）

安全基线：`contextIsolation: true`（默认开）+ `nodeIntegration: false`（默认关）+ `sandbox: false`（ESM 格式 preload 的硬性要求，不影响 contextBridge 隔离）。CSP 写在 `src/renderer/index.html` 的 meta 里。

## 渲染层结构

```
src/renderer/src/
├── types.ts                  域类型单一真源：Conversation / ChatMessage / Segment（协议段 {type,data}）/ TraceData
├── settings.ts               UI 设置应用：apply 写 CSS 变量到根节点；类型与默认值在 src/shared/settings.ts，持久化在主进程
├── useConversations.ts       会话状态缝：列表 / 归档组 / 激活会话 + 全部增删改 + 本机落盘
├── sessionSnapshot.ts        快照净化：落盘前裁掉超限 base64，读回时逐段校验（坏段丢弃）
├── useBackendChat.ts         消息通道会话桥：出站装帧、入站转段进会话（space.id 归属映射 + pending）
├── styles/
│   ├── tokens.css            设计 token 单一真源（色板 / 圆角 / 缓动 / 可调变量）
│   └── base.css              reset + 滚动条 + .app 骨架 + 跨组件共享动画帧（rise / view-in / breathe）
└── components/
    ├── Sidebar.tsx/.css      会话列表 + 悬停 ⋯ 菜单（归档/删除，靠底自动上翻）+ 已归档分组 + 品牌行连接状态点
    ├── Chat.tsx/.css         视图编排：头部 / 消息列表（自动滚底）/ 思考点 / 空状态
    ├── Message.tsx/.css      段渲染器：文本段拆段落 + 行内 code；image 段气泡内图片；file 段文件卡（保存 / 打开链接）；trace 段转交 ToolTrace
    ├── ToolTrace.tsx/.css    工具痕迹卡片（签名组件，grid-rows 平滑展开终端输出）
    ├── Composer.tsx/.css     自适应高度输入框（Enter 发送 / Shift+Enter 换行）+ 附件入口（图片 / 文件）与待发附件条；等回复期间右侧额外多一个中断键，输入与发送都不锁
    ├── Settings.tsx/.css     设置弹窗（全屏遮罩 + 居中面板，Esc / 遮罩 / × 关闭）：分类导航 + 界面滑组 + 用户（频道身份）+ 后端连接（地址 / token / 连接状态，状态文案与侧栏共用）+ 实时预览
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
- 加界面设置项：`settings.ts` 加字段（类型 + 默认值 + apply 写变量）→ `Settings.tsx` 加一行 `SliderRow` → CSS 里用 `var(--xxx)` 做作用点
- 加 `window.desktop` 能力：`preload/api.ts` 加方法 + `index.d.ts` 类型自动跟随，渲染层可选链调用
- 每轮请求 UI 改动后：`npm run typecheck` + `npm run build`，视觉改动用 `dev:web` 截图自查（改动后导航要带时间戳参数穿透缓存）

## 协议（占位已接通）

- core 侧 `DesktopServer` 已落地（`desktopPort`，默认 2147；token 与 NapCat 共用，握手阶段校验 `Authorization: Bearer`）；审批桥（`#do-yes` 按钮化）仍走 core/api（2145）的 action
- 占位帧契约（正式协议定型后替换）：出站 `{type:'message', messageId, userId, conversationId, segments}`，入站 `{type:'message', space:{from,id,conversationId?}, segments}`，段一律 `{type, data}` 统一段直传；帧类型单一真源在 `preload/api.ts`
- **会话粒度**：`conversationId` 是桌面端每条对话的 id，core 侧 `DesktopServer` 把它放上 `space.conversationId`，会话 id 变成 `user:<userId>#<conversationId>`——每条对话一份 Agent、一份短期记忆；`space.id` 仍是用户身份，故 `targetUserId` / `owner` 判定不受影响
- **连接客户端**：`src/main/backend.ts` 常驻持有传输层（Bearer 握手、自动指数重连、建连超时兜底、入站帧经 `backend:message` 广播给渲染层）；地址 / token 在设置页「后端连接」配置并实时经 `desktopApi.setBackend` 下发
- **中断**：等回复期间发送键左侧多一个方块中断键（输入与发送都不锁，连发即可——新消息进记忆后正在跑的那轮循环下一轮请求就会带上），客户端发 `{type:'abort', userId, conversationId}` 帧（不走消息管道），目标取「正在等回复的那条对话」；core 侧 `DesktopServer` 按 `toEventMeta` 推出会话后直接调 `abortSession()`，只查不建——不产生用户消息、不进模型记忆，被中断的轮次也不会再推送回复，所以思考指示当场收掉
- **会话桥**：`useBackendChat` 装帧/收帧；agent 回复按段拆帧连发（段间 3~4s 拟人间隔），客户端逐帧追加即保节奏；**归属按帧里回传的 `space.conversationId` 直接落回对话**，没带时（主动消息 / 旧后端）才回落到「最近一次发送的对话 → 当前对话」；第一帧收掉思考指示；发送不做互斥（会话内并发请求由 core 的 Agent 自己处理）；桌面频道身份 `userId` 在「用户」设置页可配（缺省 `desktop`，留空回退），随消息帧发送到后端并决定管理员/白名单判定
- **段建模**：出站段在 `useConversations.sendOutgoing` 缝内构建（text + Composer 传来的 image/file 附件段），返回值直接装帧、不做二次转换；trace 是桌面本地展示段，将来由 `tool-*` 事件在缝里转换生成，不进传输协议
- **媒体段**（占位协议扩展，与统一段同构）：image/file 段的 `data` 携带 `{media?, base64?, mime?, name?, size?}`。出站方向 core 侧 `DesktopAdapter` 把 localPath 读成 base64 随帧携带（http 引用原样透传）；入站方向客户端随帧带 base64，core 侧 `DesktopServer` 落地进 `data/desktop/` 并改写成 `media.localPath`（base64 不进上下文，识图等链路照常按路径取用）。体积上限：发送 50MB / 上传 25MB，超出跳过
- 待办：正式协议握手版本号与 `chat.*` 事件集、trace / 审批卡片事件、跨端历史同步、voice 段
- 设置页「后端连接」分类已预留（地址 / token / 连接状态）

## 本地落盘

- 会话快照走 `userData/sessions.json`（主进程 `src/main/sessions.ts`）：渲染层去抖 500ms 写一次，`beforeunload` / `pagehide` 再单向补写一次；主进程先写 `.tmp` 再改名，超过 16MB 直接丢弃
- 层级分工：`src/shared/session.ts` 只约定外层形状（`version` / `conversations` / `archived` / `activeId`），段级校验在渲染层 `sessionSnapshot.ts`——快照可能来自旧版本或被外部改坏，坏段整条丢弃
- 截断规则：会话各 200 条、单会话保留尾部 400 条消息、单段 base64 超 1.5MB 只留元信息（图片变成「本地未缓存」文件卡，文件卡仍显示名字与体积）
- 快照只是**本机缓存**：真源仍在 core 的记忆里，跨设备/跨端不共享；用 `conversationId` 与后端会话一一对应（定时苏醒任务也随 `space.conversationId` 落回原对话）；`dev:web` 无主进程时不落盘，只在内存里跑

## 已知坑

- Electron 二进制与 electron-builder 的 NSIS / winCodeSign 下载走 npmmirror（镜像键在**根** `.npmrc`，GitHub 直连会 `fetch failed`）；electron 依赖必须钉**精确版本**（无 `^`）——提升后 electron-builder 无法从范围版本解析平台二进制
- 打包：无应用图标（默认 Electron 图标，放 `build/icon.ico` 即换）；未签名，别的机器首启有 SmartScreen 提示；`release/` 已 gitignored
- ESM 产物命名：main 是 `.js`（靠 package.json 的 `type: module` 判定）、preload 是 `.mjs`（预加载无 package.json 上下文，靠扩展名自证）——`package.json#main` 与主进程里的 preload 路径必须与产物对齐
- `dev:web` 模式下 `localStorage` 与 Electron 正式环境同源策略不同（浏览器端口 5199），UI 设置两边不共享，属预期
