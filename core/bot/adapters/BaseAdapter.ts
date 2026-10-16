import type { CtxEvent, Space } from "../../types/index.ts";

export default abstract class BaseAdapter {
    protected pipeline: (ctxEvent: CtxEvent) => Promise<void>;
    protected constructor(pipeline: (ctxEvent: CtxEvent) => Promise<void>) {
        this.pipeline = pipeline;
    }

    public onMessage(ctxEvent: CtxEvent){
        return this.pipeline(ctxEvent);
    }

    public abstract sendMsg(space:Space, message:object[]|object|string): Promise<void>;

}