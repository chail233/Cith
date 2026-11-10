import type { ReplySegmentCap } from "./reply-tool.ts";

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
    };
}

/** 图片段 */
export function imageCap(): ReplySegmentCap {
    return {
        type: "image",
        description: "一张图片或表情包：media.uri 是网络链接，media.localPath 是本地路径，二选一",
        data: mediaSchema(),
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
    };
}

export function voiceCap(): ReplySegmentCap {
    return {
        type: "voice",
        description: "发送一条语音：media 指向本地音频文件或网络链接，建议 mp3",
        data: {
            type: "object",
            properties: {
                media: mediaProperties(),
            },
            required: ["media"],
            additionalProperties: false,
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
