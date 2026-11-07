import BaseAdapter from "./BaseAdapter.ts";
import type { CtxEvent, MessageSegment, Space } from "../../types/index.ts";
import logger from "../../utils/logger.js";
import { pathToFileURL } from "node:url";

export default class OnebotAdapter extends BaseAdapter{
    private ws: any;
    constructor(pipeline: (ctxEvent: CtxEvent) => Promise<void>, ws: any) {
        super(pipeline);
        this.ws = ws;
    }

    sendAction(actionObj: Action) {
        const payload = JSON.stringify(actionObj);
        logger.debug("onebot发送动作:", actionObj.action);
        this.ws.send(payload);
    }

    async sendMsg(space:Space, message: string | MessageSegment | MessageSegment[]) {
        const segments = (Array.isArray(message) ? message : [message])
            .map((seg) => this.toOnebotSegment(seg))
            .filter((seg): seg is object => seg !== null);
        if (segments.length === 0) return;
        this.sendAction({
            action: "send_msg",
            params: {
                message_type: space.from==="group" ? "group" : "private",
                group_id: space.from==="group"? space.id : null,
                user_id: space.from==="user"?space.id : null,
                message: segments
            },
        });
    }

    /** 统一消息段 → OneBot 发送段；不支持/缺资源的类型返回 null 跳过 */
    private toOnebotSegment(message: string | MessageSegment): object | null {
        // 字符串是 text 段的书写糖
        if (typeof message === "string") {
            return { type: "text", data: { text: message } };
        }
        if (message.type === "text") {
            return { type: "text", data: { text: message.data.text ?? "" } };
        }
        if (message.type === "image") {
            const media = (message.data as { media?: { localPath?: string } }).media;
            if (!media?.localPath) {
                logger.warn("OnebotAdapter 发送图片缺少 localPath，跳过");
                return null;
            }
            return { type: "image", data: { file: pathToFileURL(media.localPath).href } };
        }
        logger.warn("OnebotAdapter 暂不支持发送该消息段类型:", message.type);
        return null;
    }
}

interface Action{
    action: string;
    params?: any;
    echo?: string;
}
