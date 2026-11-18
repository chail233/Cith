import type { CtxEvent, MessageSegment, Space } from "../../types/index.ts";
import { buildReplyTool } from "./reply-tool.ts";
import type { ReplyDelivery, ReplySegmentCap, ReplyTool } from "./reply-tool.ts";

export default abstract class BaseAdapter {
    /** 通道标识：与 Space.channel 对齐，注册表靠它把主动消息路由回本适配器 */
    public abstract readonly channel: string;

    protected pipeline: (ctxEvent: CtxEvent) => Promise<void>;
    protected constructor(pipeline: (ctxEvent: CtxEvent) => Promise<void>) {
        this.pipeline = pipeline;
    }

    public onMessage(ctxEvent: CtxEvent){
        return this.pipeline(ctxEvent);
    }


    public accepts(space: Space): boolean {
        return space.channel === this.channel;
    }


    public abstract sendMsg(space:Space, message: string | MessageSegment | MessageSegment[]): Promise<void>;


    public abstract sendReply(space: Space, acts: MessageSegment[]): Promise<ReplyDelivery>;


    protected abstract replyCapabilities(): ReplySegmentCap[];

    public replyTool(): ReplyTool {
        return buildReplyTool(this.replyCapabilities());
    }

}