import config from "../config.js";
import type { Context, CtxEvent, Space } from "../types/index.ts";
import {extractText} from "../utils/extractText.ts";

export function buildContext(event: CtxEvent): Context {
    const text = extractText(event.message || []);
    const isAdmin = event.userId === config.owner;
    const isTarget = event.space.from === "user"
        ? config.targetUserId.includes(event.space.id)
        : config.targetGroupId.includes(event.space.id);

    return {
        adapter: event.adapter,
        text: text,
        space: event.space,
        senderName: resolveName(event),
        userId: event.userId,
        isAdmin:isAdmin,
        isTarget: isTarget,
        isAtBot: false,
        imageDescription: null,
        handled: false,
        seg: event.message,
    };
}


/**
 * 解析发送者昵称
 */
function resolveName(event: CtxEvent): string {
    const userId = event.userId;
    if (userId && config.members.has(userId)) {
        return config.members.get(userId) ?? "未知";
    }
    return event.nickName ?? "未知";
}
