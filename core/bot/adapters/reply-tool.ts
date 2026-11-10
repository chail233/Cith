import logger from "../../utils/logger.js";
import type { MessageSegment } from "../../types/index.ts";
import type { ToolContext, ToolDefinition } from "../../agent/types.ts";

/** 发言工具名 */
export const REPLY_TOOL_NAME = "send_message";

/**
 * 一条消息段能力：只描述「本通道能发这类段」与给模型看的 data 结构
 * 不负责字段校验与转换——模型填什么就带走什么，怎么变成平台消息由适配器自己决定
 */
export interface ReplySegmentCap {
    /** 段类型，同时是 schema 里 type 的枚举值 */
    type: string;
    /** 给模型看的用途说明 */
    description: string;
    /** 该段 data 字段的 JSON Schema */
    data: Record<string, unknown>;
}

/** 发言工具产出：成功为待发送消息段（空数组表示本轮不发言），失败为回填给模型的错误说明 */
export type ReplyToolResult = { acts: MessageSegment[] } | string;

/** 适配器对外暴露的发言工具 */
export interface ReplyTool {
    /** 角色标记：Agent 见到此工具被调用即视为"发言"，本轮到此结束 */
    kind: "reply";
    definition: ToolDefinition;
    execute: (param: unknown, ctx?: ToolContext) => Promise<ReplyToolResult>;
}

/**
 * 按能力集生成发言工具
 * @param caps 适配器声明支持的消息段能力；为空时退化为「只会报错」的工具，避免整条对话链崩掉
 */
export function buildReplyTool(caps: ReplySegmentCap[]): ReplyTool {
    if (caps.length === 0) {
        logger.error("适配器未声明任何消息段能力，发言工具不可用");
    }
    const supported = new Set(caps.map((cap) => cap.type));

    const definition: ToolDefinition = {
        type: "function",
        function: {
            name: REPLY_TOOL_NAME,
            description:
                "对外发言的唯一方式：要发消息就调用本工具，"
                + "不要用纯文本输出代替。一次调用可以携带多条消息段，按数组顺序依次发出，"
                + "借分段模拟真人连发的节奏。不需要接话时调用本工具并传空数组。"
                + "可以和其它工具同轮调用：这条发言会立刻发出，工具继续跑；活干完后需要补充就说，不需要就继续调工具。",
            parameters: {
                type: "object",
                properties: {
                    segments: {
                        type: "array",
                        description: "按发送顺序排列的消息段；不需要开口时传空数组（本轮不发言）",
                        items: caps.length === 1 ? segmentSchema(caps[0]) : { oneOf: caps.map(segmentSchema) },
                    },
                },
                required: ["segments"],
                additionalProperties: false,
            },
        },
    };

    async function execute(param: unknown): Promise<ReplyToolResult> {
        const segments = isJsonObject(param) ? param.segments : undefined;
        if (!Array.isArray(segments)) {
            return "缺少参数 segments：需要传入消息段数组，不需要发言时传空数组";
        }
        // 空数组是模型明确选择「本轮不发言」，不是参数错误
        if (segments.length === 0) return { acts: [] };
        const acts: MessageSegment[] = [];
        const rejected: string[] = [];
        segments.forEach((raw, index) => {
            const at = `第 ${index + 1} 段`;
            if (!isJsonObject(raw)) {
                rejected.push(`${at}不是对象`);
                return;
            }
            const type = typeof raw.type === "string" ? raw.type : "";
            // 只挡「本通道根本发不出去」的段类型；字段一律原样带走，不在这一层校验或改写
            if (!supported.has(type)) {
                rejected.push(`${at}类型 ${type || "(空)"} 当前通道不支持`);
                return;
            }
            acts.push({ type, data: isJsonObject(raw.data) ? (raw.data as MessageSegment["data"]) : {} });
        });
        if (rejected.length > 0) logger.warn("发言工具丢弃了当前通道不支持的段:", rejected.join("；"));
        // 一条都没剩下才把原因回给模型；部分可用照发，不让一处笔误吞掉整条回复
        if (acts.length === 0) return rejected.join("；") || "没有可发送的消息段";
        return { acts };
    }

    return { kind: "reply", definition, execute };
}

function segmentSchema(cap: ReplySegmentCap): Record<string, unknown> {
    return {
        type: "object",
        description: cap.description,
        properties: {
            type: { enum: [cap.type], description: "消息段类型" },
            data: cap.data,
        },
        required: ["type", "data"],
        additionalProperties: false,
    };
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
