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
    /** 归一化消息段：文本、@、图片一律从这里取，不再单独提字段 */
    message: MessageSegment[];
    space: Space;
    senderName: string;
    userId: string;
    isAdmin: boolean;
    isTarget: boolean;
    /** 图片识别描述（中间件产出，不来自原始消息段） */
    imageDescription: string | null;
    /** 是否已被某个 handler 处理 */
    handled: boolean;
}
