import logger from "../../utils/logger.js";
import type { MessageSegment } from "../../types/index.ts";
import type { ToolContext, ToolDefinition } from "../../agent/types.ts";

export const REPLY_TOOL_NAME = "send_message";

/** 单段解析结果：成功给消息段，失败给一句可回填给模型的错误 */
export type SegmentParse = { segment: MessageSegment } | { error: string };

/** 一条消息段能力：模型看到的 schema + 运行时的校验/规范化 */
export interface ReplySegmentCap {
    /** 段类型，同时是 schema 里 type 的枚举值 */
    type: string;
    /** 给模型看的用途说明 */
    description: string;
    /** 该段 data 字段的 JSON Schema */
    data: Record<string, unknown>;
    /** 校验 data 并转成统一消息段 */
    parse: (data: Record<string, unknown>) => SegmentParse;
}

/** 发言工具产出：成功为待发送消息段，失败为回填给模型的错误说明 */
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
    const byType = new Map(caps.map((cap) => [cap.type, cap]));

    const definition: ToolDefinition = {
        type: "function",
        function: {
            name: REPLY_TOOL_NAME,
            description:
                "对外发言的唯一方式：要说话、发图、发文件、@ 人、引用回复时都调用本工具，"
                + "不要用纯文本输出代替。一次调用可以携带多条消息段，按数组顺序依次发出，"
                + "借分段模拟真人连发的节奏。",
            parameters: {
                type: "object",
                properties: {
                    segments: {
                        type: "array",
                        minItems: 1,
                        description: "按发送顺序排列的消息段",
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
        if (!Array.isArray(segments) || segments.length === 0) {
            return "缺少参数 segments：要发送的消息段数组不能为空";
        }
        const acts: MessageSegment[] = [];
        const problems: string[] = [];
        segments.forEach((raw, index) => {
            const at = `第 ${index + 1} 段`;
            if (!isJsonObject(raw)) {
                problems.push(`${at}不是对象`);
                return;
            }
            const type = typeof raw.type === "string" ? raw.type : "";
            const cap = byType.get(type);
            if (!cap) {
                problems.push(`${at}类型 ${type || "(空)"} 当前通道不支持`);
                return;
            }
            const parsed = cap.parse(isJsonObject(raw.data) ? raw.data : {});
            if ("error" in parsed) {
                problems.push(`${at}（${cap.type}）${parsed.error}`);
                return;
            }
            acts.push(parsed.segment);
        });
        if (problems.length > 0) logger.warn("发言工具丢弃了不合法的消息段:", problems.join("；"));
        // 一条都没解析成功才把原因回给模型；部分成功照发，不让一处笔误吞掉整条回复
        if (acts.length === 0) return problems.join("；") || "没有可发送的消息段";
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
