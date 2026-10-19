import type BaseAdapter from "../bot/adapters/BaseAdapter.ts";

// Agent 系统独有类型（ToolCall/LlmResult/ReplyAct/ReplyPayload/PendingToolCall/Plan 等）见 core/agent/types.ts

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
