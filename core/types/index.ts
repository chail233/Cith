import type BaseAdapter from "../bot/adapters/BaseAdapter.ts";

/** 消息发生的空间 */
export interface Space {
    from: "user" | "group";
    id: string;
}

/** OneBot 消息段 */
export interface MessageSegment {
    type: string;
    data: Record<string, unknown> & {
        text?: string;
    };
}

/** adapters 归一化后传给 buildContext 的事件结构 */
export interface CtxEvent {
    adapter: BaseAdapter;
    message: MessageSegment[];
    space: Space;
    userId: string;
    nickName: string;
}

export interface Context {
    adapter: BaseAdapter;
    text: string;
    space: Space;
    senderName: string;
    userId: string;
    isAdmin: boolean;
    isTarget: boolean;
    /** 是否 @ 了机器人 */
    isAtBot: boolean;
    /** 图片识别描述 */
    imageDescription: string | null;
    /** 是否已被某个 handler 处理 */
    handled: boolean;
    seg: object;
}

/** 模型返回的待执行工具调用（OpenAI function call 结构） */
export interface ToolCall {
    id: string;
    function: { name: string; arguments: string };
}

/** LLM 返回的助手消息（content 与 tool_calls 至多其一非空由模型行为决定） */
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

/** 挂起等待管理员确认的危险工具操作（tool-approval 队列条目） */
export interface PendingToolCall {
    toolCall: ToolCall;
    toolName: string;
    requestedBy: string;
    requestedByName: string;
    space: Space | null;
    createdAt: number;
}
