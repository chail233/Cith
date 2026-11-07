import type { CtxEvent, MessageSegment, Space } from "../../types/index.ts";

export default abstract class BaseAdapter {
    protected pipeline: (ctxEvent: CtxEvent) => Promise<void>;
    protected constructor(pipeline: (ctxEvent: CtxEvent) => Promise<void>) {
        this.pipeline = pipeline;
    }

    public onMessage(ctxEvent: CtxEvent){
        return this.pipeline(ctxEvent);
    }

    /** 发送消息：统一消息段按类型执行平台动作；字符串是 text 段的书写糖 */
    public abstract sendMsg(space:Space, message: string | MessageSegment | MessageSegment[]): Promise<void>;

}