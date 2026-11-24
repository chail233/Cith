# 从源码运行

[使用索引](../README.md#快速开始) · [通用配置](configuration.md)

## 环境要求

- Node.js **>= 24**（`npm start` 依赖原生 type stripping 直接跑 `.ts`）
- QQ 接入需要 NapCat 已运行并配置好反向 WebSocket（只用微信 / 桌面端则不需要）

## 一键初始化（推荐）

```bash
git clone https://github.com/chail233/Cith
cd Cith

# Windows（PowerShell）
powershell -ExecutionPolicy Bypass -File setup.ps1

# Linux / macOS
bash setup.sh
```

脚本会依次：检查 Node 版本 → 根上 `npm install`（workspaces 统一安装 core / web / desktop）→ 交互式问必填项（`owner`、`selfId`、模型地址与 Key、NapCat 地址、面板端口与密码等）→ 生成 `packages/core/config.json` 与 `packages/web/.env`（`BOT_API_TOKEN` 自动对齐）→ 校验配置能否加载 → 检查端口 →（首次）构建 Web 面板 → 前台启动并打印面板与反向 WS 地址。

只写两个已 gitignore 的文件，不碰 `config.js`；重复运行先备份旧文件。密钥输入不回显。

- `npm run setup -- --check`：只读检查；`--no-start`：只写配置不启动；`--force`：备份后重新生成

## 手动配置

```bash
git clone https://github.com/chail233/Cith
cd Cith
npm install
npm start
```

NapCat 反向 WebSocket 地址：`ws://127.0.0.1:8080/onebot/v11/ws`（端口随 `wsPort`）。该端点与 NapCat HTTP 复用同一个 `token`，握手携带 `Authorization: Bearer <token>`（或 `?access_token=`），不匹配直接 401 并按来源 IP 记告警。

**npm 脚本：**

| 命令 | 说明 |
|------|------|
| `npm start` | 直接运行 `packages/core/`（开发推荐，改完即生效） |
| `npm run build` | tsc 编译 core → `dist/` 并拷贝资源 |
| `npm run start:dist` | 运行构建产物（部署用，需先 build） |
| `npm run build:web` | 编译 Web 面板 → `packages/web/dist/` |
| `npm run build:desktop` | 编译桌面客户端 → `packages/desktop/out/` |
| `npm run build:all` | core + web |
| `npm test` | Node 内置测试运行器跑 `tests/` |
| `npm run add-stickers` | 用视觉模型批量给表情包生成描述与标签 |

> `start` 与 `start:dist` 行为一致，差异只是现场转译 vs 预编译纯 JS；`dist/` 不提交。

## 更新

```bash
bash update.sh            # 拉取 + 按需装依赖 + 编译
bash update.sh --web      # 连 Web 面板一起编译
bash update.sh --stash    # 临时暂存本地改动，结束后恢复
bash update.sh --force    # 远端无新提交也重新编译
```

只用 `--ff-only` 拉取，本地分叉直接报错；被 gitignore 的本地文件（配置、`mcp/`、`data/`）不会被动。更新后按运行方式重启：`npm start` / `npm run start:dist` / `pm2 restart <应用名>`。
