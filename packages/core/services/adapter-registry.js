import logger from "../utils/logger.js";

/**
 * 通道适配器注册表
 * key 就是 Space.channel，一个通道同时只留一个实例：新连接顶掉旧实例，旧实例的关闭事件不会误删新实例
 */
const adapters = new Map();

export function registerAdapter(channel, adapter) {
    adapters.set(channel, adapter);
    logger.debug(`适配器已注册: ${channel}`);
}

export function unregisterAdapter(channel, adapter) {
    // 只在登记的确实是这个实例时摘除
    if (adapters.get(channel) !== adapter)
        return;
    adapters.delete(channel);
    logger.debug(`适配器已注销: ${channel}`);
}

/** 适配器是否愿意为这个会话发消息（替身没实现 accepts 时视为不接受） */
function accepts(adapter, space) {
    return Boolean(adapter?.accepts?.(space));
}

/**
 * 为没有现成 ctx.adapter 的场景（定时苏醒、主动消息）找回发送通道
 * 先按 Space.channel 精确查表，再让愿意跨通道兜底的适配器自荐
 * @param space 目标会话
 * @returns 可用适配器；没有任何通道能服务该会话时返回 null
 */
export function resolveAdapter(space) {
    const exact = adapters.get(space?.channel);
    if (accepts(exact, space))
        return exact;
    for (const adapter of adapters.values()) {
        if (accepts(adapter, space))
            return adapter;
    }
    return null;
}
