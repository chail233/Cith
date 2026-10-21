# 表情包模块（stickers）

表情包的**索引与检索**层。只负责「读索引 + 按标签查」，不负责消息段构造、不负责提示词、不负责发送。

拆开的原因：图库和检索逻辑跟具体适配器无关，OneBot 能用，微信也能用；上层想怎么发是上层的事。

## 目录约定

```
core/
  stickers/
    index.js              # 本模块
    manifest.json         # 索引文件（默认读取）
    manifest.example.json # 示例索引
    images/               # 表情包图片放这里
      cat/001.png
```

- 索引路径默认 `stickers/manifest.json`，可用 `options.manifestPath` 覆盖（相对 `core/`）。
- 图片路径相对 `manifest.baseDir`，缺省为 `stickers/images`。
- 所有路径都过 `utils/file-security.js` 的 `resolveSrcPath`，越出 `core/` 直接拒绝。

## 索引格式

```json
{
  "version": 1,
  "baseDir": "stickers/images",
  "vocabulary": ["笑", "无语", "疑惑"],
  "items": [
    {
      "id": "cat_001",
      "file": "cat/001.png",
      "desc": "柴郡猫咧嘴大笑",
      "tags": ["笑"],
      "weight": 1
    }
  ]
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 全局唯一，调用方按它取图 |
| `file` | 是 | 相对 `baseDir`，禁止绝对路径和 `..` |
| `desc` | 是 | 人话描述：画面是什么、什么情绪、什么场合用。**这是选图的主要依据** |
| `tags` | 否 | 情绪/场景词，检索入口 |
| `weight` | 否 | 命中权重，默认 1。常用图调高，冷门梗图调低 |
| `vocabulary` | 否 | 标签词表。填了之后，条目里出现词表外的标签会告警 |

## 用法

```js
import { listTags, queryStickers, randomSticker, getSticker } from "../stickers/index.js";

listTags();                                   // [{ tag: "无语", count: 2 }, ...]
queryStickers({ tags: ["无语"], limit: 5 });    // [{ id, desc, tags }, ...] 不含路径
randomSticker({ tags: ["笑"] });               // 单条候选，没有则 null
getSticker("cat_001");                        // { ...item, path: "/abs/path.png" }，可直接送 image 段
```

## 设计要点

- **不把整库塞给模型**：`queryStickers` 只返回 `id / desc / tags`，路径和尺寸不外露；`limit` 默认 10，硬上限 50。
- **候选要打散**：命中数优先，权重做微调，再叠一层随机扰动，避免同标签下永远挑同一张。
- **支持排重**：`excludeIds` 用于「这条已经发过，别再发」。
- **索引热加载**：按 `mtime` 判断是否需要重读，改完 manifest 无需重启。
- **脏数据不炸**：非法条目逐条丢弃并告警，索引坏了降级为空库。

## 加表情包的流程

1. 图片丢进 `stickers/images/<分类>/`。
2. 在 `manifest.json` 的 `items` 里加一条，`desc` 写清楚画面和情绪。
3. 完事，不用改代码。

## 尚未接入

- 消息段构造与发送（`{ cmd: "sticker", id }` → `image` 段）
- 工具注册：让模型通过工具拉取某一 tag 的候选后再选 id
- 词表维护脚本：从现有 `tags` 反推 `vocabulary`