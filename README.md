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

- [Windows 桌面版](docs/desktop.md) · 本地 Core、远程连接与数据迁移
- [Linux Docker 部署](docs/docker.md) · 拉取镜像、首次配置、启动与升级
- [从源码运行](docs/source.md) · 一键初始化、手动安装与更新
- [通用配置](docs/configuration.md) · 配置文件与主要参数
- [Web 管理面板](packages/web/README.md) · 面板部署与配置

## License

[MIT](LICENSE)
