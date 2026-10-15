/**
 * Action 白名单路由
 */
import logger from "../utils/logger.js";
import type { ActionHandler } from "./types.ts";

const handlers = new Map<string, ActionHandler>();

/** 注册一个 action 处理函数（在各 action 模块加载时调用） */
export function registerAction(name: string, handler: ActionHandler): void {
    handlers.set(name, handler);
}

/** 批量注册 */
export function registerActions(entries: Record<string, ActionHandler>): void {
    for (const [name, handler] of Object.entries(entries)) {
        handlers.set(name, handler);
    }
}

/** 当前已注册的 action 列表（可供面板查询能力清单） */
export function listActions(): string[] {
    return [...handlers.keys()];
}

/**
 * 分发执行一个 action。
 * @throws 未知 action 时抛错，由调用方（server）转成 error 帧
 */
export async function dispatch(
    action: string,
    params: Record<string, unknown> = {},
): Promise<unknown> {
    const handler = handlers.get(action);
    if (!handler) {
        logger.warn(`API 未知 action 被拒绝: ${action}`);
        throw new Error(`unknown action: ${action}`);
    }
    return await handler(params);
}
