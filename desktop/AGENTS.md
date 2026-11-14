# AGENTS.md（desktop）

本文件为 AI 编码代理与开发者提供桌面客户端（`desktop/`）的工作指南。仓库级指南见根目录 [AGENTS.md](../AGENTS.md)；面向使用者的简介见 [README.md](README.md)。

## 定位

- Cith 的桌面客户端：Electron + React 18 + TS + electron-vite，独立 npm 工程，**与 core 完全解耦**，仅经 WS 协议通信（协议尚未实现，方向见下文「协议」）
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

## 进程模型（Electron 三段）

- `src/main/` —— 主进程（Node 环境，每个 App 一个）：窗口生命周期、IPC handler。**后端 WS 客户端在 `backend.ts`**——主进程不随窗口关闭而死，常驻连接是托盘 / 系统通知的前提
- `src/preload/` —— 预加载桥：`api.ts` 定义 `desktopApi`（单一真源），经 `contextBridge` 暴露为 `window.desktop`，类型通过 `index.d.ts` 给渲染层。**能力收口**：渲染层永远不直接碰 Node，新能力逐个显式加进 `desktopApi`
- `src/renderer/` —— React 界面（结构与数据流见下）

安全基线：`contextIsolation: true`（默认开）+ `nodeIntegration: false`（默认关）+ `sandbox: false`（ESM 格式 preload 的硬性要求，不影响 contextBridge 隔离）。CSP 写在 `src/renderer/index.html` 的 meta 里。

## 渲染层结构

```
src/renderer/src/
├── types.ts                  域类型单一真源：Conversation / ChatMessage / Segment（协议段 {type,data}）/ TraceData
├── settings.ts               UI 设置：load / save（localStorage）/ apply（写 CSS 变量到根节点）
├── useConversations.ts       会话状态缝：列表 / 归档组 / 激活会话 + 全部增删改
├── useBackendChat.ts         消息通道会话桥：出站装帧、入站转段进会话（space.id 归属映射 + pending）
├── styles/
│   ├── tokens.css            设计 token 单一真源（色板 / 圆角 / 缓动 / 可调变量）
│   └── base.css              reset + 滚动条 + .app 骨架 + 跨组件共享动画帧（rise / view-in / breathe）
└── components/
    ├── Sidebar.tsx/.css      会话列表 + 悬停 ⋯ 菜单（归档/删除，靠底自动上翻）+ 已归档分组 + 品牌行连接状态点
    ├── Chat.tsx/.css         视图编排：头部 / 消息列表（自动滚底）/ 思考点 / 空状态
    ├── Message.tsx/.css      段渲染器：文本段拆段落 + 行内 code；trace 段转交 ToolTrace
    ├── ToolTrace.tsx/.css    工具痕迹卡片（签名组件，grid-rows 平滑展开终端输出）
    ├── Composer.tsx/.css     自适应高度输入框（Enter 发送 / Shift+Enter 换行）
    ├── Settings.tsx/.css     分类导航 + 界面滑组 + 用户（频道身份）+ 后端连接（地址 / token / 连接状态，状态文案与侧栏共用）+ 实时预览
    └── icons.tsx             手写 SVG，不引图标库
```

**数据流**（一次发送的旅程）：Composer `onSend` → `App.handleSend`（须已连接）→ `chat.send()` 装帧发出（用户消息已在缝内建段）→ 入站帧经 `useBackendChat` 转段、按归属映射落会话 → React 重渲染 → `Message` / `ToolTrace`。

**数据源缝在 `useBackendChat`**：协议侧数据从这里进出，组件层零感知。组件内不直接操作会话数据，一律走 hook 方法。

## 约定

- 注释一律中文；类型导入必须 `import type`
- 颜色 / 圆角 / 缓动不写魔法值，进 `tokens.css`；组件私有样式与组件同名同目录，跨组件的动画帧进 `styles/base.css`；**不画边框线**，分层靠表面色阶和软阴影（用户审美红线：冷色、线条堆结构）
- 加消息段类型：`types.ts` 加类型 → `Message.tsx` 加分支 → 必要时新组件一个
- 加界面设置项：`settings.ts` 加字段（类型 + 默认值 + apply 写变量）→ `Settings.tsx` 加一行 `SliderRow` → CSS 里用 `var(--xxx)` 做作用点
- 加 `window.desktop` 能力：`preload/api.ts` 加方法 + `index.d.ts` 类型自动跟随，渲染层可选链调用
- 每轮请求 UI 改动后：`npm run typecheck` + `npm run build`，视觉改动用 `dev:web` 截图自查（改动后导航要带时间戳参数穿透缓存）

## 协议（占位已接通）

- core 侧 `DesktopServer` 已落地（`desktopPort`，默认 2147；token 与 NapCat 共用，握手阶段校验 `Authorization: Bearer`）；审批桥（`#do-yes` 按钮化）仍走 core/api（2145）的 action
- 占位帧契约（正式协议定型后替换）：出站 `{type:'message', messageId, userId, segments}`，入站 `{type:'message', space:{from,id}, segments}`，段一律 `{type, data}` 统一段直传；帧类型单一真源在 `preload/api.ts`
- **连接客户端**：`src/main/backend.ts` 常驻持有传输层（Bearer 握手、自动指数重连、建连超时兜底、入站帧经 `backend:message` 广播给渲染层）；地址 / token 在设置页「后端连接」配置并实时经 `desktopApi.setBackend` 下发
- **会话桥**：`useBackendChat` 装帧/收帧；agent 回复按段拆帧连发（段间 3~4s 拟人间隔），客户端逐帧追加即保节奏，第一帧解锁输入、后续帧按 space.id 归位；桌面频道身份 `userId` 在「用户」设置页可配（缺省 `desktop`，留空回退），随消息帧发送到后端并决定会话归属；主动消息（定时苏醒）无 pending 时按映射落到对应会话
- **段建模**：出站段在 `useConversations.sendOutgoing` 缝内构建（目前仅 text），返回值直接装帧、不做二次转换；trace 是桌面本地展示段，将来由 `tool-*` 事件在缝里转换生成，不进传输协议
- 待办：正式协议握手版本号与 `chat.*` 事件集、trace / 审批卡片事件、历史同步、图片等段能力放开
- 设置页「后端连接」分类已预留（地址 / token / 连接状态）

## 已知坑

- Electron 二进制下载走 npmmirror（已固化在 `.npmrc`），GitHub 直连会 `fetch failed`
- ESM 产物命名：main 是 `.js`（靠 package.json 的 `type: module` 判定）、preload 是 `.mjs`（预加载无 package.json 上下文，靠扩展名自证）——`package.json#main` 与主进程里的 preload 路径必须与产物对齐
- `dev:web` 模式下 `localStorage` 与 Electron 正式环境同源策略不同（浏览器端口 5199），UI 设置两边不共享，属预期
