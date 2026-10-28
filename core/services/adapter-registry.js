import logger from "../utils/logger.js";

/**
 * 适配器注册表：消息通道（OneBot / 微信）在连接建立时注册进来，
 * 供没有来消息的主动链路（定时任务）取用发送通道。
 */
const adapters = new Map();

export function registerAdapter(kind, adapter) {
    adapters.set(kind, adapter);
    logger.debug(`适配器已注册: ${kind}`);
}

export function unregisterAdapter(kind, adapter) {
    if (adapters.get(kind) === adapter) {
        adapters.delete(kind);
        logger.debug(`适配器已注销: ${kind}`);
    }
}

function isUsable(adapter) {
    if (!adapter)
        return false;
    if (adapter.closed === true)
        return false;
    return true;
}

export function resolveAdapter(space) {
    const order = space?.from === "group" ? ["onebot"] : ["onebot", "wechat"];
    for (const kind of order) {
        const adapter = adapters.get(kind);
        if (isUsable(adapter))
            return adapter;
    }
    return null;
}

export function listAdapters() {
    return [...adapters.entries()].map(([kind, adapter]) => ({ kind, usable: isUsable(adapter) }));
}