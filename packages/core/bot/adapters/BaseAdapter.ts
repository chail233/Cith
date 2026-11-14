import type { CtxEvent, MessageSegment, Space } from "../../types/index.ts";
import { buildReplyTool } from "./reply-tool.ts";
import type { ReplySegmentCap, ReplyTool } from "./reply-tool.ts";

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

    /**
     * 能否为这个会话发送消息
     * 默认只服务自己的通道；只有愿意跨通道兜底的适配器才覆盖它
     */
    public accepts(space: Space): boolean {
        return space.channel === this.channel;
    }

    /** 发送消息：统一消息段按类型执行平台动作；字符串是 text 段的书写糖 */
    public abstract sendMsg(space:Space, message: string | MessageSegment | MessageSegment[]): Promise<void>;


    protected abstract replyCapabilities(): ReplySegmentCap[];

    public replyTool(): ReplyTool {
        return buildReplyTool(this.replyCapabilities());
    }

}