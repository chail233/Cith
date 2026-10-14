---
name: notes
description: AI 的自我备忘录。以结构化 JSON 列表维护，AI 通过脚本自由添加/更新/删除笔记；因 force 标记，本文件正文（含笔记列表）会被固定注入每一次对话的上下文。
force: true
---

# 笔记（Notes）

这是 **AI 自己的笔记本**。你（AI）可以随时、自由地记录想记住的东西，并通过脚本以结构化方式维护和更新。

## 固定注入上下文

本技能标记了 `force: true`，因此**本 SKILL.md 的正文（含下方「笔记列表」的 JSON）会被固定注入每一次对话的 system prompt**。写在这里的内容你在每一轮都直接看得到，无需 read_file，也不会被记忆摘要冲掉。

## 数据结构

笔记是一个 JSON 数组，每条笔记字段如下：

- `id`：整数，唯一且自增（由脚本自动分配，勿手动指定）
- `content`：笔记内容（字符串）
- `tags`：标签数组（可选，如 `["preference","todo"]`）
- `createdAt` / `updatedAt`：`YYYY-MM-DD`（脚本自动维护）

## 如何维护（调用脚本，勿手动编辑 JSON 块）

所有增删改都通过 `run_JS` 调用以下脚本完成，路径相对 `core/`：

**添加笔记：**
```
filepath: skills/notes/scripts/note-add.js
args: { "content": "笔记内容", "tags": ["可选","标签"] }
```

**更新笔记**（按 id，可只改 content 或只改 tags）：
```
filepath: skills/notes/scripts/note-update.js
args: { "id": 1, "content": "新内容", "tags": ["新标签"] }
```

**删除笔记**（按 id）：
```
filepath: skills/notes/scripts/note-del.js
args: { "id": 1 }
```

脚本会读写下方的 JSON 块并同步日期/id。当前笔记内容即下面 `NOTES` 标记之间的 JSON。

## 注意

- **精炼为先**：本文件每一轮都会整段注入上下文，笔记越多越占 token。请及时合并重复项、删除过时或已完成的内容。
- **只改 JSON 块**：不要动 frontmatter（`---` 之间），也不要删改笔记列表区上下两个 NOTES 注释标记，否则脚本会找不到锚点。

## 笔记列表

<!-- NOTES:START -->

```json
[
  {
    "id": 1,
    "content": "笔记本已创建，这是第一条示例笔记，可通过脚本更新或删除",
    "tags": ["example"],
    "createdAt": "2026-10-14",
    "updatedAt": "2026-10-14"
  }
]
```

<!-- NOTES:END -->