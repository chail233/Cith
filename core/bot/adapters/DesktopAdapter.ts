import BaseAdapter from "./BaseAdapter.ts";
import type { CtxEvent, MessageSegment, Space } from "../../types/index.ts";
import logger from "../../utils/logger.js";
import { renderApprovalNotice, toApprovalData } from "../../utils/approval-notice.ts";
import { WebSocket } from "ws";
import { textCap } from "./reply-segment-caps.ts";
import type { ReplySegmentCap } from "./reply-tool.ts";

/**
 * 桌面客户端能力
 * 协议尚未定型，先只开文本；图片/文件等随正式协议一起放开
 */
const DESKTOP_CAPS: ReplySegmentCap[] = [textCap()];

export default class DesktopAdapter extends BaseAdapter {
    readonly channel = "desktop";

    private readonly ws: WebSocket;
    constructor(pipeline: (ctxEvent: CtxEvent) => Promise<void>, ws: WebSocket) {
        super(pipeline);
        this.ws = ws;
    }

    protected replyCapabilities(): ReplySegmentCap[] {
        return DESKTOP_CAPS;
    }

    async sendMsg(space: Space, message: string | MessageSegment | MessageSegment[]) {
        if (this.ws.readyState !== WebSocket.OPEN) {
            logger.warn("桌面客户端未连接，消息未发送");
            return;
        }
        const segments = (Array.isArray(message) ? message : [message]).flatMap((seg) => {
            // 字符串是 text 段的书写糖
            if (typeof seg === "string") {
                return [{ type: "text", data: { text: seg } }];
            }
            switch (seg.type) {
                case "text":
                    return [seg];
                case "tool_approval":
                    // 门禁询问先以纯文本呈现；审批桥（core/api action 按钮化）落地后再上卡片
                    return [{ type: "text", data: { text: renderApprovalNotice(toApprovalData(seg.data)) } }];
                default:
                    logger.warn("DesktopAdapter 暂不支持发送该消息段类型:", seg.type);
                    return [];
            }
        });
        if (segments.length === 0) return;
        this.ws.send(JSON.stringify({ type: "message", space: { from: space.from, id: space.id }, segments }));
    }
}
