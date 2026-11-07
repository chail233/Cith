import logger from "../utils/logger.js";
import type { MessageSegment } from "../types/index.ts";

/**
 * 处理 AI 回复内容，支持三种格式：
 *   1. {action: [...]}  — 预期的标准格式（type/data 消息段）
 *   2. [...]            — AI 直接返回段数组
 *   3. 纯文本           — 降级为单个 text 段
 */
export function parseReply(content: string | null | undefined): MessageSegment[] {
    if (!content || content.trim() === "") return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    }
    catch {
        logger.error("AI 返回非 JSON 格式:", content);
        return textSegment(content);
    }

    // 标准格式：{action: [...]}
    if (isJsonObject(parsed) && Array.isArray(parsed.action)) {
        return parsed.action.flatMap<MessageSegment>(toSegment);
    }
    // AI 直接返回数组
    if (Array.isArray(parsed)) {
        return parsed.flatMap<MessageSegment>(toSegment);
    }
    // JSON 对象但没有合法 action 字段，降级为文本
    logger.warn("AI 返回 JSON 但格式不匹配:", content);
    return textSegment(content);
}

/** 守卫：任意 JSON 对象（非数组） */
function isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 单条模型输出 → 统一消息段；无法识别的条目丢弃（返回空数组） */
function toSegment(value: unknown): MessageSegment[] {
    if (!isJsonObject(value)) return [];

    // 标准段格式：{type, data}
    const data = isJsonObject(value.data) ? value.data : {};
    switch (value.type) {
        case "text":
            if (typeof data.text !== "string") break;
            return [{ type: "text", data: { text: data.text } }];
        case "image": {
            const media = toMediaRef(data.media);
            if (!media) break;
            return [{ type: "image", data: { media } }];
        }
        case "file": {
            const media = toMediaRef(data.media);
            if (!media) break;
            const seg: MessageSegment = { type: "file", data: { media } };
            if (typeof data.name === "string" && data.name !== "") seg.data.name = data.name;
            return [seg];
        }
        case "mention":
            if (typeof data.id !== "string" || data.id === "") break;
            return [{ type: "mention", data: { id: data.id } }];
        case "reply":
            if (typeof data.id !== "string" || data.id === "") break;
            return [{ type: "reply", data: { id: data.id } }];
        default:
            break;
    }


    logger.warn("AI 回复包含无法识别的消息段，已丢弃:", JSON.stringify(value));
    return [];
}

/** 媒体引用守卫：uri（http/https 链接）或 localPath（本地路径）至少有其一 */
function toMediaRef(value: unknown): { uri: string; localPath?: string } | null {
    if (!isJsonObject(value)) return null;
    const uri = typeof value.uri === "string" ? value.uri : "";
    const localPath = typeof value.localPath === "string" ? value.localPath : "";
    if (uri === "" && localPath === "") return null;
    // 模型把本地路径误填进 uri 字段时纠正为 localPath
    if (uri !== "") {
        if (!/^https?:\/\//.test(uri)) return { uri: "", localPath: uri };
        return { uri };
    }
    return localPath !== "" ? { uri: "", localPath } : null;
}

/** 降级用：裸文本 → 单个 text 段 */
function textSegment(text: string): MessageSegment[] {
    return [{ type: "text", data: { text } }];
}
