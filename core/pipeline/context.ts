import config from "../config.js";
import type { Context, CtxEvent } from "../types/index.ts";

export function buildContext(event: CtxEvent): Context {
    const message = event.message ?? [];
    for (const seg of message) {
        if (seg.type !== "mention") continue;
        const data = seg.data as { id?: string; name?: string };
        if (!data.name) data.name = resolveName(data.id);
    }

    const isAdmin = event.userId === config.owner;
    const isTarget = event.space.from === "user"
        ? config.targetUserId.includes(event.space.id)
        : config.targetGroupId.includes(event.space.id);

    return {
        adapter: event.adapter,
        messageId: event.messageId,
        message,
        space: event.space,
        senderName: resolveName(event.userId, event.nickName),
        userId: event.userId,
        isAdmin: isAdmin,
        isTarget: isTarget,
        imageDescription: null,
        handled: false,
    };
}


/**
 * 解析昵称：优先 members 映射，其次回退到传入的昵称
 */
export function resolveName(qq: string | undefined | null, fallbackName?: string): string {
    const id = qq == null ? "" : String(qq);
    if (id && config.members.has(id)) {
        return config.members.get(id) ?? "未知";
    }
    return fallbackName ?? "未知";
}
