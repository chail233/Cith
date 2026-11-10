import { isJsonObject } from "./reply-tool.ts";
import type { ReplySegmentCap } from "./reply-tool.ts";
import type { MediaRef } from "../../types/segment.ts";
import type { MessageSegment } from "../../types/index.ts";

/** 纯文本段 */
export function textCap(): ReplySegmentCap {
    return {
        type: "text",
        description: "一段文本消息；多条消息就拆成多个 text 段，模拟真人连发",
        data: {
            type: "object",
            properties: { text: { type: "string", description: "文本内容" } },
            required: ["text"],
            additionalProperties: false,
        },
        parse(data) {
            const text = typeof data.text === "string" ? data.text : "";
            if (text.trim() === "") return { error: "data.text 为空" };
            return { segment: { type: "text", data: { text } } };
        },
    };
}

/** 图片段 */
export function imageCap(): ReplySegmentCap {
    return {
        type: "image",
        description: "一张图片或表情包：media.uri 是网络链接，media.localPath 是本地路径，二选一",
        data: mediaSchema(),
        parse(data) {
            const media = parseMedia(data.media);
            if (typeof media === "string") return { error: media };
            return { segment: { type: "image", data: { media } } };
        },
    };
}

/** 文件段：可为本地文件或网络链接，name 缺省时由适配器按路径推断 */
export function fileCap(): ReplySegmentCap {
    return {
        type: "file",
        description: "发送一个文件：media 指向本地路径或网络链接，name 为展示用文件名",
        data: {
            type: "object",
            properties: {
                media: mediaProperties(),
                name: { type: "string", description: "文件名，如 报告.pdf" },
            },
            required: ["media"],
            additionalProperties: false,
        },
        parse(data) {
            const media = parseMedia(data.media);
            if (typeof media === "string") return { error: media };
            const segment: MessageSegment = { type: "file", data: { media } };
            const name = typeof data.name === "string" ? data.name.trim() : "";
            if (name !== "") segment.data.name = name;
            return { segment };
        },
    };
}

/** media 字段的 JSON Schema */
function mediaProperties(): Record<string, unknown> {
    return {
        type: "object",
        properties: {
            uri: { type: "string", description: "http(s) 网络链接" },
            localPath: { type: "string", description: "本地路径（相对 core/ 或绝对路径）" },
        },
        additionalProperties: false,
    };
}

/** 只有 media 一个必填字段的段 schema */
function mediaSchema(): Record<string, unknown> {
    return {
        type: "object",
        properties: { media: mediaProperties() },
        required: ["media"],
        additionalProperties: false,
    };
}

/**
 * media 参数规范化
 * @returns 合法的媒体引用，或一句错误说明（模型把本地路径填进 uri 时自动纠正）
 */
function parseMedia(value: unknown): MediaRef | string {
    if (!isJsonObject(value)) return "缺少 media 对象";
    const uri = typeof value.uri === "string" ? value.uri.trim() : "";
    const localPath = typeof value.localPath === "string" ? value.localPath.trim() : "";
    if (uri === "" && localPath === "") return "media.uri 与 media.localPath 至少要填一个";
    if (uri !== "") {
        if (!/^https?:\/\//i.test(uri)) return { uri: "", localPath: uri };
        return { uri };
    }
    return { uri: "", localPath };
}
