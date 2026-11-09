/**
 * Agent 系统独有类型
 */
import type { Context, MessageSegment, Space } from "../types/index.ts";
import type Agent from "./Agent.ts";

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

/** 一次 LLM 调用的用量 */
export interface LlmUsage {
    /** 实际请求的模型 */
    model: string;
    /** 输入 token（含缓存命中部分） */
    inputTokens: number;
    /** 输出 token */
    outputTokens: number;
    /** 前缀缓存命中的输入 token */
    cachedTokens: number;
    /** 总消耗 */
    totalTokens: number;
}

/** LLM 聊天补全接口成功返回的结构 */
export interface LlmResult {
    message: LlmResponseMessage;
    totalTokens: number;
    /** 归一化用量；服务商未返回 usage 时为 null */
    usage: LlmUsage | null;
}

/** Agent "reply" 事件负载：本轮解析出的回复消息段 + 累计 tokens */
export interface ReplyPayload {
    acts: MessageSegment[];
    tokens: number;
}

/** 一轮 Agent 主循环的产出：最终要发送的消息段 + 本轮累计 tokens */
export type AgentRunOutcome = ReplyPayload;

/** 单次工具调用的执行记录；args 为 null 表示参数解析失败 */
export interface ToolExecution {
    toolCall: ToolCall;
    name: string;
    args: Record<string, unknown> | null;
    output: string;
}

/** 挂起等待管理员确认的危险工具操作 */
export interface PendingToolCall {
    toolCall: ToolCall;
    toolName: string;
    requestedBy: string;
    requestedByName: string;
    space: Space | null;
    createdAt: number;
}

/** 任务计划步骤状态 */
export type PlanStatus = "pending" | "in_progress" | "done" | "cancelled";

/** 任务计划步骤条目 */
export interface PlanItem {
    content: string;
    status: PlanStatus;
}

/** 一份完整任务计划：总体目标 + 步骤清单 */
export interface Plan {
    goal: string;
    items: PlanItem[];
}

/** manage_plan 工具入参的原始形式：来自模型生成的 JSON，字段类型不可信，需经归一化 */
export type RawTodo = { content?: unknown; status?: unknown } | null | undefined;

/** OpenAI function calling 格式的单个工具定义 */
export interface ToolDefinition {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

/** 工具执行上下文：请求上下文 + 调用方注入的 Agent 会话引用 */
export interface ToolContext extends Context {
    agent?: Agent | null;
}

/** 单个 Agent 工具模块：definition 提供给模型，execute 为实现 */
export interface ToolModule<P = unknown> {
    definition: ToolDefinition;
    execute: (param: P, ctx?: ToolContext) => Promise<string>;
}
