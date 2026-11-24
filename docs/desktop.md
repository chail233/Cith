# Windows 桌面版

[使用索引](../README.md#快速开始) · [通用配置](configuration.md)

下载 Windows x64 安装版或便携版，两者都带内置 Core。 [GitHub Releases](https://github.com/chail233/Cith/releases)

- **本地运行**。在 **本地核心 → 运行** 选择「本地内置核心」，到 **配置 → 模型** 填写地址、模型名和 API Key，保存后回到 **运行** 点「启动」。只用桌面聊天可关闭 OneBot 和微信接入。
- **连接已有 Core**。在 **本地核心 → 运行** 选择「远程后端」，到 **设置 → 后端连接** 填写 `ws://服务器地址:2147` 和 Core 配置中的 `token`。自定义端口时使用 `desktopPort`。

如果 Core 启用了私聊白名单，将 **设置 → 用户** 里的 ID（默认 `desktop`）加入 `targetUserId`。

## 从无头版迁移到桌面本地核心

1. 在 **本地核心 → 运行** 点「打开核心配置目录」，记下目标位置。停止两个 Core，备份源数据和目标目录。
2. 将旧 `config.json` 和 `data/` 复制进去，按需复制 `prompts/`、`skills/`、`stickers/` 和 `workspace/`。旧路径默认在 `packages/core/`（`npm start`）或 `dist/`（`npm run start:dist`），Docker 版默认在部署目录的 `profile/`。有 `CITH_CONFIG` 或 `CITH_DATA` 时以这些配置为准。
3. 保留原来的 embedding 提供方和模型。自定义 `memoryStorePath` 时，把记忆文件放在新核心目录下，并填入相对路径。迁移微信时，从旧日志找到凭证目录，复制到 `wechatbot/`，并把 `wechatStorageDir` 设为新目录的绝对路径。
4. 换机器时检查模型、Ollama 和 NapCat 的地址。启动本地核心，发条消息并查看 **日志**。

`data/` 包含长期记忆、笔记和定时任务。QQ、微信的聊天记录不会出现在桌面侧栏。
