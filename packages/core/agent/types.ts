import type { Context, MessageSegment, Space } from "../types/index.ts";
import type { ToolApprovalData } from "../types/segment.ts";
import type Agent from "./Agent.ts";


/** 发给模型的一条请求消息（content 可以是字符串，也可以是视觉模型要求的段数组） */
export interface LlmMessage {
    role: string;
    content?: unknown;
}

/** 一条对话历史消息：content 已序列化为字符串（上下文组装与摘要都用这个形状） */
export interface ChatMessage {
    role: string;
    content: string;
}

/** 模型返回的待执行工具调用 */
export interface ToolCall {
    id: string;
    function: { name: string; arguments: string };
}

/** LLM 返回的助手消息 */
export interface LlmResponseMessage {
    content?: string | null;
    tool_calls?: ToolCall[];
}

export interface LlmUsage {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    totalTokens: number;
}

export interface LlmResult {
    message: LlmResponseMessage;
    usage: LlmUsage | null;
}




export interface ToolDefinition {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

/** 单个 Agent 工具模块：definition 提供给模型，execute 为实现 */
export interface ToolModule<P = unknown> {
    definition: ToolDefinition;
    execute: (param: P, ctx?: ToolContext) => Promise<string>;
}


export interface ToolContext extends Context {
    agent?: Agent | null;
    signal?: AbortSignal;
}


export interface ToolHold extends ToolApprovalData {
    /** 标记位，用于与正常文本输出区分 */
    held: true;
    /** 挂起原因（guard 判定 / 未配置 guard 模型等） */
    reason: string;
    /** 被挂起的调用参数摘要（已截断） */
    summary: string;
}

/** 单个工具的调用结果：正常为文本输出，被门禁拦截时为挂起信息 */
export type ToolCallResult = string | ToolHold;

/** 单次工具调用的执行记录；args 为 null 表示参数解析失败 */
export interface ToolExecution {
    toolCall: ToolCall;
    args: Record<string, unknown> | null;
    output: ToolCallResult;
}

/** 待确认队列里的挂起项：工具名单独留一份，排队期间不依赖 toolCall 解析 */
export interface PendingToolCall {
    toolCall: ToolCall;
    toolName: string;
    requestedBy: string;
    requestedByName: string;
    space: Space | null;
    createdAt: number;
}



/** 本轮发言：待发送的消息段（空数组 = 本轮不发言） */
export interface ReplyOutcome {
    acts: MessageSegment[];
}

/** 本轮主循环因门禁挂起而中止：等待管理员确认，本轮不发言 */
export interface HeldOutcome {
    held: ToolHold[];
}

/** 本轮主循环被用户中断：不投递任何消息，已发出的部分保留 */
export interface AbortedOutcome {
    aborted: true;
}

/** 主循环一轮的完整结果：发言 / 门禁挂起 / 被中断；模型或通道出错时退化为错误文本 */
export type AgentRunResult = ReplyOutcome | HeldOutcome | AbortedOutcome | string;


export interface WakeTrigger {
    type: string;
    id?: string;
    title?: string;
    prompt?: string;
}

export type PlanStatus = "pending" | "in_progress" | "done" | "cancelled";

export interface PlanItem {
    content: string;
    status: PlanStatus;
}

export interface Plan {
    goal: string;
    items: PlanItem[];
}

export type RawTodo = { content?: unknown; status?: unknown } | null | undefined;


export interface RecalledMemory {
    text: string;
    createdAt: number;
}