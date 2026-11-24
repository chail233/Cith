# Linux Docker 部署

[使用索引](../README.md#快速开始) · [通用配置](configuration.md)

需要 Docker Engine 和 Docker Compose。Docker 镜像包含无头 Core。Web 面板单独部署，Core 的面板 API 默认只监听容器内的 `127.0.0.1:2145`。

## 首次配置和启动

将 Compose 文件保存到部署目录，以普通用户执行下面的命令。首次运行配置向导时，Docker 会直接拉取 `ghcr.io/chail233/cith-core:latest`（Linux amd64）。 [compose.yaml](../compose.yaml)

```bash
mkdir -p profile
export CITH_UID="$(id -u)" CITH_GID="$(id -g)"
docker compose run --rm core setup
docker compose up -d
docker compose logs -f core
```

配置向导会询问模型地址、模型名、API Key 和接入方式，结果保存到 `profile/config.json`。输入 API Key 时会隐藏密钥。已有配置可直接复制到这个路径，然后用 `docker compose up -d` 拉取镜像并启动。配置、提示词、技能、记忆和会话都保存在 `profile/`。可把 `CITH_UID`、`CITH_GID` 和自定义端口写入部署目录下的 `.env`，供后续 Compose 命令使用。

GitHub Actions 会将 `master` 上通过容器测试的镜像发布到 GHCR。首次发布后，仓库维护者需要在包设置中将可见性设为 **Public**，用户就能匿名拉取。 [GHCR 包可见性](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility#about-setting-visibility-and-access-permissions-for-packages)

## 接入方式

- **QQ**：宿主机上的 NapCat 默认连 `ws://127.0.0.1:8080/onebot/v11/ws`，token 与 Core 配置里的 `token` 一致。NapCat 在同一 Docker 网络时用 `ws://core:8080/onebot/v11/ws`。
- **桌面客户端**：宿主机上的客户端默认连 `ws://127.0.0.1:2147`，使用同一个接入 token。
- **远程连接**：默认端口只发布到宿主机回环地址。通过 Compose 的 `.env` 或 shell 环境把对应的 `CITH_ONEBOT_BIND` 或 `CITH_DESKTOP_BIND` 设为宿主机的内网 IP。可用 `CITH_ONEBOT_PORT` 和 `CITH_DESKTOP_PORT` 修改宿主机端口。迁入配置若改过容器内的 `wsPort` 或 `desktopPort`，还要相应调整 `compose.yaml` 的映射目标。改完执行 `docker compose up -d`。
- **微信**：首次登录或会话过期时，从 `docker compose logs -f core` 获取扫码链接。迁移时把旧凭证放进 `profile/wechatbot/`，并将 `wechatStorageDir` 设成 `/app/profile/wechatbot`。
- **模型和扩展服务**：模型、Ollama 和自定义 MCP 的地址应从容器内可达，容器内的 `127.0.0.1` 指向容器本身。向导默认关闭长期记忆，配置好 embedding 后可在 `profile/config.json` 启用。

## 重启和升级

修改 `profile/config.json` 后，用 `docker compose restart core` 重启。升级时先停止服务并备份 `profile/`，然后执行 `docker compose up -d --pull always` 拉取并启动新镜像。需要固定版本时，可在 `.env` 中把 `CITH_IMAGE` 设为带 `sha-<提交 SHA>` 标签的镜像。

## 本地构建或离线导入

从源码构建时，在仓库根目录执行以下命令：

```bash
docker build -t cith-core:local .
```

基础镜像默认从 Docker Hub 拉取。也可以在构建命令中加上 `--build-arg NODE_IMAGE=public.ecr.aws/docker/library/node:24-bookworm-slim`。

离线部署可在 GitHub Actions 的成功运行中下载 `cith-core-linux-amd64` 构建产物。解压后，将其中的 `compose.yaml` 放在部署目录，再执行 `docker load -i cith-core-linux-amd64.tar.gz`。 [GitHub Actions](https://github.com/chail233/Cith/actions)

这两种方式都在部署目录的 `.env` 中设置 `CITH_IMAGE=cith-core:local`，再按首次启动的步骤配置和运行。升级时先重建或导入新的本地镜像，随后执行 `docker compose up -d --pull never`。
