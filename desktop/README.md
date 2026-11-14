# sunbatwobot-desktop

Cith 的桌面客户端（Electron）。独立 npm 工程，与 `core/` 后端完全解耦，仅通过 WS 协议通信（协议待定）。

## 开发

```bash
npm install
npm run dev        # 开发模式（Vite HMR + Electron）
npm run build      # 类型检查 + 编译，产物输出到 out/
npm run preview    # 运行编译产物
npm run typecheck  # 只做类型检查（node / web 两个子项目）
```

## 结构

- `src/main/` —— 主进程：窗口生命周期、后端连接层（待实现）
- `src/preload/` —— 预加载：contextBridge 暴露 `window.desktop`（类型声明在 `index.d.ts`）
- `src/renderer/` —— 渲染层：React + TS
  - `types.ts` 会话/消息/段域类型；`styles/tokens.css` 设计 token 单一真源
  - `useConversations.ts` 会话状态缝（协议接通后数据从这里进出）；`useDemoReply.ts` 演示回复节奏（届时整体删除）
  - `mock/` 演示数据；`components/` 按组件分文件，样式与组件同名同目录

## 待接入

- 后端连接协议（DesktopServer WS 通道 + 审批桥，见仓库 AGENTS.md）
- electron-builder 打包与自动更新
