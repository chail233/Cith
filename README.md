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

### 环境要求

- Node.js **>= 24**（`npm start` 依赖原生 type stripping 直接跑 `.ts`）
- QQ 接入需要 NapCat 已运行并配置好反向 WebSocket（只用微信 / 桌面端则不需要）

### 一键初始化（推荐）

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

### 手动配置

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

### 更新

```bash
bash update.sh            # 拉取 + 按需装依赖 + 编译
bash update.sh --web      # 连 Web 面板一起编译
bash update.sh --stash    # 临时暂存本地改动，结束后恢复
bash update.sh --force    # 远端无新提交也重新编译
```

只用 `--ff-only` 拉取，本地分叉直接报错；被 gitignore 的本地文件（配置、`mcp/`、`data/`）不会被动。更新后按运行方式重启：`npm start` / `npm run start:dist` / `pm2 restart <应用名>`。

## 使用

### Windows 桌面版

桌面发布包包含 Windows x64 安装版（`Cith-Setup-…-x64.exe`）和便携版（`Cith-Portable-…-x64.exe`），两者都带内置 Core，可直接启动。下载带 `desktop-v` 标签的版本。 [GitHub Releases](https://github.com/chail233/Cith/releases)

也可以在 Windows 上安装 Node.js 和仓库依赖后，从仓库根目录运行 `npm run bundle:desktop -- --win --x64 --publish never`，产物位于 `packages/desktop/release/`。

- **本地内置核心**：打开侧栏 **本地核心 → 运行**，将「消息通道」切换到「本地内置核心」。在 **配置 → 模型** 填写模型地址、对话模型和 API Key，保存后回到 **运行** 点「启动」。客户端会自动连接本机 Core，也可以开启「随应用启动本地核心」。只用桌面聊天时，可在配置页关闭 OneBot 和微信接入。
- **连接已有 Core**：在 **本地核心 → 运行** 选择「远程后端」，再到 **设置 → 后端连接** 填写服务器地址和 Token。同机可用 `ws://127.0.0.1:2147`，跨设备用 Core 所在机器的地址。端口取旧实例的 `desktopPort`，Token 取 `config.json` 顶层的 `token`。

两种模式都使用 **设置 → 用户** 中的桌面用户 ID，默认是 `desktop`。如果所连 Core 配置了私聊白名单，将该 ID 加入 `targetUserId`。需要从桌面使用管理员命令时，也将该 ID 加入 `owner`。

### 从无头版迁移到桌面本地核心

1. **找到旧实例的数据。** `npm start` 默认从 `packages/core/` 读取配置和数据，`npm run start:dist` 默认从 `dist/` 读取。若旧实例设置了 `CITH_CONFIG` 或 `CITH_DATA`，分别使用它们所指的配置文件和数据根。迁移微信登录时，可从旧实例日志中的「WechatBot凭证目录」找到实际路径。
2. **打开目标目录并停止两个实例。** 首次打开桌面版后，在 **本地核心 → 运行** 点「打开核心配置目录」。打开的目录就是下表的 `core/`。停掉无头版和桌面本地核心，关闭桌面版，并备份源数据以及目标 `core/` 中已有的文件。
3. **按下面的对应关系复制。** 对目录复制其中的内容，避免多套一层同名目录。

   | 迁移内容 | 旧实例位置 | 桌面本地核心位置 |
   | --- | --- | --- |
   | 用户配置 | `CITH_CONFIG` 指向的文件，默认是 `packages/core/config.json` 或 `dist/config.json` | `core/config.json` |
   | 运行数据，包括长期记忆、笔记、定时任务和媒体 | 旧数据根下的 `data/` | `core/data/` |
   | 自定义提示词、技能、表情包及工作文件 | 旧数据根下的 `prompts/`、`skills/`、`stickers/`、`workspace/`（按需） | `core/` 下的同名目录 |
   | 微信登录凭证（按需） | 旧实例日志中的凭证目录 | `core/wechatbot/` |

4. **检查迁移后的配置。** 用本地核心的配置页检查模型和接入地址。跨机器迁移时，旧配置里的 `127.0.0.1` 或 `localhost` 需要按实际服务位置调整，例如 Ollama 和 NapCat HTTP。迁移了微信凭证时，将 `wechatStorageDir` 设为新 `core/wechatbot/` 的绝对路径。若继续使用 QQ，将 NapCat 的反向 WS 地址指向新 Core，并核对 `token`。
5. **启动并验证。** 在 **本地核心 → 运行** 选择「本地内置核心」并启动。发一条测试消息，在 **日志** 页查看结果，再验证需要保留的长期记忆、定时任务和渠道登录。

迁移长期记忆时，保留原来的 `memoryEmbedProvider` 和 `memoryEmbedModel`。默认记忆文件是 `core/data/rememori/memory.mem`。如果自定义过 `memoryStorePath`，将文件放到新 `core/` 下并更新为对应的相对路径。每个 `.mem` 文件只能由一个 Core 进程打开。

迁移后，长期记忆可以继续检索。桌面消息列表来自客户端自己的会话记录，QQ 和微信的聊天历史不会导入桌面侧栏。

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