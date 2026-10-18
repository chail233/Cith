/**
 * Agent 系统独有类型（仅 AI 模块内部及事件消费方使用）
 */
import type { Space } from "../types/index.ts";

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

/** LLM 聊天补全接口成功返回的结构 */
export interface LlmResult {
    message: LlmResponseMessage;
    totalTokens: number;
}

/** AI 回复动作：{action:[...]} 数组中的单条 */
export interface ReplyAct {
    cmd: string;
    content: string;
}

/** Agent "reply" 事件负载：本轮解析出的动作 + 累计 tokens */
export interface ReplyPayload {
    acts: ReplyAct[];
    tokens: number;
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
