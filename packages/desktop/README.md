# sunbatwobot-desktop

Cith 的桌面客户端（Electron）。workspace 子包（`packages/desktop/`），与 `packages/core/` 后端完全解耦，仅通过 WS 协议通信（占位协议已接通，正式协议待定型）。

## 开发

```bash
npm install        # 在仓库根执行一次即可（workspaces 统一安装）
npm run dev        # 开发模式（Vite HMR + Electron）
npm run build      # 类型检查 + 编译，产物输出到 out/
npm run preview    # 运行编译产物
npm run typecheck  # 只做类型检查（node / web 两个子项目）
npm run dist       # 打包分发产物 → release/（NSIS 安装包 + portable）
```

## 结构

- `src/main/` —— 主进程：窗口生命周期、IPC handler；**后端连接客户端在 `backend.ts`**（Bearer 握手鉴权、自动重连，状态与消息帧经 IPC 广播给渲染层）
- `src/preload/` —— 预加载：contextBridge 暴露 `window.desktop`（类型声明在 `index.d.ts`），帧与状态类型单一真源在 `api.ts`
- `src/renderer/` —— 渲染层：React + TS
  - `types.ts` 会话/消息域类型（`Segment` 即协议段形状 `{type, data}`）
  - `useConversations.ts` 会话状态缝（出站消息段在此构建）；`useBackendChat.ts` 消息通道会话桥（装帧/收帧）
  - `components/` 按组件分文件，样式与组件同名同目录

工程级约定与协议现状见 [AGENTS.md](AGENTS.md)。

## 待接入

- 正式协议（握手版本号、`chat.*` 事件集、trace / 审批卡片、历史同步）
- electron-builder 自动更新
