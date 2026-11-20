# Cith 桌面客户端

Cith 的 Electron 客户端：React + TypeScript，workspace 子包（`packages/desktop/`），与 `packages/core/` 完全解耦，只经 WebSocket 协议通信。

## 开发

```bash
npm install          # 仓库根执行一次即可（workspaces 统一安装）
npm run dev          # Electron 开发模式（main/preload 秒编译，renderer HMR）
npm run dev:web      # 只在浏览器跑渲染层（:5199）；无 window.desktop，相关能力自动降级
npm run build        # 类型检查 + 编译 → out/
npm run preview      # 运行 out/ 产物
npm run typecheck    # 只做类型检查（node / web 两个子项目）
npm run dist         # 打包 → release/（NSIS 安装包 + portable）
```

> 改了 `main/` 或 `preload/` 必须完全退出客户端再启动；只靠渲染层热更新会出现「界面是新的、`window.desktop` 是旧的」的半更新状态。

## 自动打包和发布

推送到 `master` 且改动涉及桌面端、内置 Core、共享 UI 或打包依赖和配置时，GitHub Actions 会构建 Windows x64 NSIS 安装版和便携版。构建成功后会发布到 **Releases**，标签为 `desktop-v<版本>`。两个 `.exe` 也可在 **Build Windows desktop** 的 **Artifacts** 下载。

构建版本保留本包 `package.json` 的主版本号和次版本号，补丁号为基准补丁号加工作流运行编号。标签、安装包和应用使用同一版本号。重跑沿用原版本，失败或取消的运行可能导致跳号。

### 客户端更新

Windows 发布版启动时检查更新，也可以打开 **设置 → 关于 → 检查更新**。安装版在后台下载新版，用户确认重启后先停止本地 Core，再安装并重新打开应用。便携版会提示前往 Release 下载。

CI 会随安装包上传 `latest.yml` 和 `.blockmap`。如需 Windows 代码签名，在仓库 Actions Secrets 中设置 `WIN_CSC_LINK` 和 `WIN_CSC_KEY_PASSWORD`，让 electron-builder 签名并在更新配置中记录发布者。

## 功能

- **连接**：core 的 `DesktopServer`（`desktopPort`，默认 2147，Bearer 握手复用 `token`）；地址与 token 在设置页「后端连接」里配，主进程常驻连接、关窗重开后自动恢复。
- **独立会话**：每条对话在后端是独立会话（`user:<userId>#<conversationId>`），各有 Agent 与短期记忆；回复帧回传 `conversationId`，消息直接落回原对话。
- **发送与中断**：等回复期间可继续发送（新消息进记忆，运行中的循环下一轮会读到）；方块键发 `abort` 帧中断当前轮，不产生消息、不进记忆。
- **本地历史**：快照落在 `userData/sessions.json`（只是缓存，真源在 core 记忆里），去抖 500ms 写入 + 关窗补写；保留条数与清空在设置页「会话」。
- **设置**：界面（字号 / 行高 / 段间距 / 消息间距 / 内容宽度）、通用（开机自启、发送快捷键）、会话（保留条数、打开数据目录、清空本地记录）、通知（回复通知 + 测试通知）、用户（频道身份）、后端连接。

## 结构

```
src/main/        主进程：窗口、IPC；backend.ts 常驻 WS；settings.ts / sessions.ts 落盘
src/preload/     contextBridge 暴露 window.desktop（api.ts 是类型单一真源）
src/renderer/    React 界面：useConversations 状态缝、useBackendChat 会话桥、components/
src/shared/      主进程与渲染层共用：设置项（含 mergeSettings 校验）、快照外形
```

消息段与协议帧同构（`{type, data}`），支持 text / image / file。工程约定、协议细节与扩展方式见 [AGENTS.md](AGENTS.md)。

## 待接入

- 正式协议：握手版本号、`chat.*` 事件集、trace / 审批卡片、跨端历史同步

