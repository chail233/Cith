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

    protected constructor(pipeline: (ctxEvent: CtxEvent) => Promise<void>) {
        this.pipeline = pipeline;
    }


    protected abstract toSegments(msg: TPlatformMessage): Promise<MessageSegment[]>;

    protected abstract toEventMeta(msg: TPlatformMessage): PlatformEventMeta;

    /** 模板方法：子类收到平台消息后调用，完成统一转换并推入管道 */
    protected async dispatch(msg: TPlatformMessage): Promise<void> {
        try {
            const message = await this.toSegments(msg);
            // 转换结果为空（不支持的内容 / 脏数据）直接忽略
            if (message.length === 0) return;
            if (!this.adapter) return;
            const meta = this.toEventMeta(msg);
            const ctxEvent: CtxEvent = {
                adapter: this.adapter,
                messageId: meta.messageId,
                message,
                space: meta.space,
                userId: meta.userId,
                nickName: meta.nickName,
            };
            await this.adapter.onMessage(ctxEvent);
        }
        catch (err) {
            logger.error("平台消息转换失败:", err);
        }
    }
}
