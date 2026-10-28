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
        senderName: resolveName(event.userId, event.nickName),
        userId: event.userId,
        isAdmin:isAdmin,
        isTarget: isTarget,
        at: null,
        imageDescription: null,
        handled: false,
        seg: event.message,
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
