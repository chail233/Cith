import logger from "../../utils/logger.js";
import type BaseAdapter from "../adapters/BaseAdapter.ts";
import type { CtxEvent, MessageSegment, Space } from "../../types/index.ts";

/** 平台消息归一化出的元信息（文本/媒体内容由 toSegments 产出） */
export interface PlatformEventMeta {
    space: Space;
    userId: string;
    nickName: string;
    messageId: string;
}

export default abstract class BaseServer<TPlatformMessage = unknown> {
    protected adapter: BaseAdapter | undefined;
    protected pipeline: (ctxEvent: CtxEvent) => Promise<void>;

    /** 同一消息事件的去重窗口：窗口内重复上报只处理一次 */
    private static readonly DEDUP_WINDOW_MS = 5 * 60 * 1000;
    /** 已见 messageId → 首见时间；平台对同一条消息可能重复上报（重连重放等） */
    private readonly seenEvents = new Map<string, number>();

    protected constructor(pipeline: (ctxEvent: CtxEvent) => Promise<void>) {
        this.pipeline = pipeline;
    }


    protected abstract toSegments(msg: TPlatformMessage): Promise<MessageSegment[]>;

    protected abstract toEventMeta(msg: TPlatformMessage): PlatformEventMeta;

    /** 模板方法：子类收到平台消息后调用，完成统一转换并推入管道 */
    protected async dispatch(msg: TPlatformMessage, sourceAdapter?: BaseAdapter): Promise<void> {
        try {
            const meta = this.toEventMeta(msg);
            // 入站去重：同一 messageId 在窗口内重复上报只处理一次，避免同一句话被答两遍
            if (this.isDuplicateEvent(meta.messageId)) return;
            const message = await this.toSegments(msg);
            // 转换结果为空（不支持的内容 / 脏数据）直接忽略
            if (message.length === 0) return;
            const adapter = sourceAdapter ?? this.adapter;
            if (!adapter) return;
            const ctxEvent: CtxEvent = {
                adapter,
                messageId: meta.messageId,
                message,
                space: meta.space,
                userId: meta.userId,
                nickName: meta.nickName,
            };
            await adapter.onMessage(ctxEvent);
        }
        catch (err) {
            logger.error("平台消息转换失败:", err);
        }
    }

    /** 判断是否为去重窗口内的重复上报；messageId 为空（平台未提供）时不去重 */
    private isDuplicateEvent(messageId: string): boolean {
        if (messageId === "") return false;
        const now = Date.now();
        const seenAt = this.seenEvents.get(messageId);
        if (seenAt !== undefined && now - seenAt < BaseServer.DEDUP_WINDOW_MS) {
            logger.info(`收到重复消息事件，已忽略: message_id=${messageId}`);
            return true;
        }
        this.seenEvents.set(messageId, now);
        // 表过大时顺带清理过期项，防止无限增长
        if (this.seenEvents.size > 1000) {
            for (const [id, ts] of this.seenEvents) {
                if (now - ts >= BaseServer.DEDUP_WINDOW_MS) this.seenEvents.delete(id);
            }
        }
        return false;
    }
}
