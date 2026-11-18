import type { Context } from "../types/index.ts";
import type { ToolApprovalData } from "../types/segment.ts";
import type Agent from "./Agent.ts";


export interface ChatMessage {
    role: string;
    content: string | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
}

/** 模型返回的待执行工具调用 */
export interface ToolCall {
    id: string;
    function: { name: string; arguments: string };
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
