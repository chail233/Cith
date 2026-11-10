import type BaseAdapter from "../bot/adapters/BaseAdapter.ts";

/** 消息发生的空间 */
export interface Space {
    from: "user" | "group";
    id: string;
    channel: "onebot" | "wechat";
}

export interface MessageSegment {
    type: string;
    data: Record<string, unknown> & {
        text?: string;
    };
}

/** adapters 归一化后传给 buildContext 的事件结构 */
export interface CtxEvent {
    adapter: BaseAdapter;
    messageId: string;
    message: MessageSegment[];
    space: Space;
    userId: string;
    nickName: string;
}

export interface Context {
    adapter: BaseAdapter;
    messageId: string;
    message: MessageSegment[];
    space: Space;
    senderName: string;
    userId: string;
    isAdmin: boolean;
    isTarget: boolean;
    /** 是否已被某个 handler 处理 */
    handled: boolean;
}
