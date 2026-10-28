import logger from "../utils/logger.js";

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
    return !adapter.closed;

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
