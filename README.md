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

**Cith** 是一个自持的个人 Agent。

它不是「接一句话回一句」的聊天机器人——你说一句需求，它自己拆任务、调工具、看结果、接着推理，办妥之后再像朋友一样回你。它看得懂图、听得懂语音、记得你的事，还能给自己装技能、给自己定闹钟。

- **多平台适配** —— 通过Server和Adapter在约定通信协议下适配多平台如QQ/微信/桌面客户端
- **真能做事** —— 多轮工具调用 + `run_shell`（小模型审查 + 待确认队列）
- **分层记忆** —— 短期 → 中期概括 → 长期语义检索，超长自动摘要，聊得再久也不失忆
- **自我扩展** —— `SKILL.md` 技能可从 GitHub 在线安装，它也能自己给自己装
- **会主动干活** —— 定时苏醒执行任务；群里冷场时判断要不要搭句话
- **两套驾驶舱** —— Web 面板看状态与用量；桌面客户端负责日常对话与中断
- **自持可控** —— 自己的机器、OpenAI 兼容任意端点、路径与命令都有门禁

## 快速开始

### Windows 桌面版

下载 Windows x64 安装版或便携版，两者都带内置 Core。 [GitHub Releases](https://github.com/chail233/Cith/releases)

- **本地运行**。在 **本地核心 → 运行** 选择「本地内置核心」，到 **配置 → 模型** 填写地址、模型名和 API Key，保存后回到 **运行** 点「启动」。只用桌面聊天可关闭 OneBot 和微信接入。
- **连接已有 Core**。在 **本地核心 → 运行** 选择「远程后端」，到 **设置 → 后端连接** 填写 `ws://服务器地址:2147` 和 Core 配置中的 `token`。自定义端口时使用 `desktopPort`。

如果 Core 启用了私聊白名单，将 **设置 → 用户** 里的 ID（默认 `desktop`）加入 `targetUserId`。

#### 从无头版迁移到桌面本地核心

1. 在 **本地核心 → 运行** 点「打开核心配置目录」，记下目标位置。停止两个 Core，备份源数据和目标目录。
2. 将旧 `config.json` 和 `data/` 复制进去，按需复制 `prompts/`、`skills/`、`stickers/` 和 `workspace/`。旧路径默认在 `packages/core/`（`npm start`）或 `dist/`（`npm run start:dist`），有 `CITH_CONFIG` 或 `CITH_DATA` 时以这些配置为准。
3. 保留原来的 embedding 提供方和模型。自定义 `memoryStorePath` 时，把记忆文件放在新核心目录下，并填入相对路径。迁移微信时，从旧日志找到凭证目录，复制到 `wechatbot/`，并把 `wechatStorageDir` 设为新目录的绝对路径。
4. 换机器时检查模型、Ollama 和 NapCat 的地址。启动本地核心，发条消息并查看 **日志**。

`data/` 包含长期记忆、笔记和定时任务。QQ、微信的聊天记录不会出现在桌面侧栏。

### 无头版

#### 环境要求

- Node.js **>= 24**（`npm start` 依赖原生 type stripping 直接跑 `.ts`）
- QQ 接入需要 NapCat 已运行并配置好反向 WebSocket（只用微信 / 桌面端则不需要）

#### 一键初始化（推荐）

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

#### 手动配置

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

#### 更新

```bash
bash update.sh            # 拉取 + 按需装依赖 + 编译
bash update.sh --web      # 连 Web 面板一起编译
bash update.sh --stash    # 临时暂存本地改动，结束后恢复
bash update.sh --force    # 远端无新提交也重新编译
```

只用 `--ff-only` 拉取，本地分叉直接报错；被 gitignore 的本地文件（配置、`mcp/`、`data/`）不会被动。更新后按运行方式重启：`npm start` / `npm run start:dist` / `pm2 restart <应用名>`。

## 配置

两层，`git pull` 永不覆盖用户配置：

- `packages/core/config.js` —— 默认值层，随仓库分发，可提交
- `packages/core/config.json` —— 用户配置层，**gitignored**（可用 `CITH_CONFIG` 指向仓库外的文件）

合并规则：标量与数组整体覆盖；普通对象只覆盖写了的字段；`mcpServers` 是唯一按 `name` 增量合并的数组；`members` 写成 `{"QQ号": "昵称"}`；`$` / `_` 开头的键是注释；解析失败直接中止启动，不静默降级。旧版大写键自动迁移为 camelCase。

运行期 `config` 由 Proxy 包裹，顶层键赋值会读-改-写回 `config.json`（面板热改即走这里）。启动自检会检查关键项是否仍是模板占位符，把「致命 / 提示」两级问题写入面板「运行状态」页——避免配置没填对却看着一切正常。

主要配置项（完整默认值见 `config.js`）：

| 配置项 | 说明 |
|--------|------|
| `wsPort` / `token` | OneBot 反向 WS 端口（默认 8080）与 NapCat 鉴权 token |
| `napcatHttpHost` | NapCat HTTP API 地址（默认 `127.0.0.1:3000`，取图片等走这里） |
| `owner` / `selfId` | 管理员 ID / 机器人 QQ 号 |
| `targetGroupId` / `targetUserId` | 目标群 / 用户白名单（管理员在目标会话发 `#bind` 可自动加入） |
| `llmApiUrl` / `aiApiKey` / `chatModel` | 文本模型端点、密钥与模型名（OpenAI 兼容） |
| `visionApiKey` / `visionModel` | 识图模型（缺省回落文本模型配置） |
| `enableLongTermMemory` / `memoryMaxRecords` | 长期记忆开关（默认开）与容量上限（默认 2000） |
| `memoryEmbedProvider` / `memoryEmbedModel` | embedding 提供方（`ollama` 本地 / `openai` 兼容）与模型 |
| `web` | 面板 API：`port`（2145）/ `path` / `token` / `logBufferSize` |
| `desktopPort` | 桌面客户端 WS 端口（默认 2147，token 与 NapCat 共用） |
| `shellGate` / `guard*` | `run_shell` 门禁模式（`guard` / `open`）与 guard 模型端点 |
| `mcpServers` | MCP Server 列表（默认自带无需凭据的 `websearch`；当前运行时已解耦未接入，仅保留配置项） |


## License

[MIT](LICENSE)