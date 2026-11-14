/**
 * Bot API 通信协议类型定义
 */

/** Web → Bot 请求帧 */
export interface RequestFrame {
    /** 客户端生成的唯一 ID，用于关联响应 */
    id: string;
    /** 动作名，必须在白名单路由内 */
    action: string;
    /** 动作参数 */
    params?: Record<string, unknown>;
    /** 鉴权帧携带的 token（仅 action === "auth" 时使用） */
    token?: string;
}

/** Bot → Web 成功响应帧 */
export interface ResponseOkFrame {
    id: string;
    status: "ok";
    data?: unknown;
}

/** Bot → Web 失败响应帧 */
export interface ResponseErrorFrame {
    id: string;
    status: "error";
    message: string;
}

export type ResponseFrame = ResponseOkFrame | ResponseErrorFrame;

/** Bot → Web 主动事件推送帧 */
export interface EventFrame {
    type: "event";
    /** 事件名，如 log / message.received */
    event: string;
    /** 毫秒时间戳，供客户端断线后按 since 补拉 */
    ts: number;
    data: unknown;
}

/** action 处理函数 */
export type ActionHandler = (
    params: Record<string, unknown>,
) => unknown | Promise<unknown>;
