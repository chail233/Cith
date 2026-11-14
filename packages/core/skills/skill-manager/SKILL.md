---
name: skill-manager
description: 管理 agent Skill 的安装和卸载。从 GitHub 仓库安装新技能，卸载已有技能。
force: false
---

# Skill Manager

管理 Agent Skill 的生命周期：从 GitHub 仓库安装和卸载 Skill。

## 可用命令

### 1. 安装技能（install）

从 GitHub 仓库下载 Skill 到本地 skills 目录。

```
filepath: skills/skill-manager/scripts/install-skill.js
args: { "repo": "仓库地址" }
```

支持的仓库地址格式：
- `owner/repo` — 如 `octocat/hello-world`
- `owner/repo/subdir` — 如 `octocat/hello-world/skills/my-skill`
- `https://github.com/owner/repo` — 完整 URL
- `https://github.com/owner/repo/tree/main/subdir` — 带子目录的 URL

返回安装结果，包含技能名称、描述和本地路径。

### 2. 卸载技能（uninstall）

删除本地 skills 目录中的技能。

```
filepath: skills/skill-manager/scripts/uninstall-skill.js
args: { "name": "技能名称" }
```

参数 `name` 为 skills 目录下的文件夹名。

返回卸载结果，包含技能名称和已删除路径。

### 3. 设置强加载（set-force）

将指定技能标记为强加载技能（`force: true`），使其 `SKILL.md` 正文固定注入每次对话的上下文。

```
filepath: skills/skill-manager/scripts/set-force-skill.js
args: { "name": "技能名称" }
```

参数 `name` 为 skills 目录下的文件夹名。修改后下一条消息即生效（每回合现取）。

### 4. 取消强加载（unset-force）

将指定技能取消强加载（`force: false`），其正文不再固定注入上下文。

```
filepath: skills/skill-manager/scripts/unset-force-skill.js
args: { "name": "技能名称" }
```

返回操作结果，包含技能名称、force 状态和 SKILL.md 路径。

## 注意事项

- 安装前会自动探测 SKILL.md 位置，兼容多种仓库结构
- 如果技能已存在，会提示先卸载再安装
- 任何安装和卸载操作都需要先向管理员确认再执行，即使是由管理员发起的
- 本技能不可被卸载
