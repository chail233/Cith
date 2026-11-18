import { readFile } from "node:fs/promises";
import BaseAdapter from "./BaseAdapter.ts";
import type { CtxEvent, MessageSegment, Space } from "../../types/index.ts";
import logger from "../../utils/logger.js";
import { renderApprovalNotice, toApprovalData } from "../../utils/approval-notice.ts";
import { mediaBasename, normalizeMedia, resolveSendablePath } from "../../utils/segment-media.ts";
import { WebSocket } from "ws";
import { fileCap, imageCap, textCap } from "./reply-segment-caps.ts";
import type { ReplyDelivery, ReplySegmentCap } from "./reply-tool.ts";

/**
 * 桌面客户端能力
 * 占位协议直传统一段；本地媒体读成 base64 随帧携带（客户端多半不在同一台机器上）
 */
const DESKTOP_CAPS: ReplySegmentCap[] = [textCap(), imageCap(), fileCap()];

/** 随帧携带的媒体体积上限，超出跳过（base64 会再膨胀 1/3，别把 WS 帧撑爆） */
const MAX_SEND_BYTES = 50 * 1024 * 1024;

/** 常见扩展名 → MIME，构造 data URL 与展示用 */
const MIME_BY_EXT: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    mp4: "video/mp4",
    pdf: "application/pdf",
    zip: "application/zip",
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    csv: "text/csv",
};

export function mimeFromName(name: string): string {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

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

    /** 发言执行（桌面语义）：单帧携带全部段直发，本地 UI 无需拟人节奏；空文本段没有展示价值，出帧前滤掉 */
    async sendReply(space: Space, acts: MessageSegment[]): Promise<ReplyDelivery> {
        const segments = acts.filter((seg) => !(seg.type === "text" && !(seg.data.text ?? "").trim()));
        if (segments.length === 0) return { attempts: 0, failures: [] };
        if (this.ws.readyState !== WebSocket.OPEN) {
            return { attempts: 1, failures: ["桌面客户端未连接"] };
        }
        try {
            await this.sendMsg(space, segments);
            return { attempts: 1, failures: [] };
        } catch (err) {
            return { attempts: 1, failures: [err instanceof Error ? err.message : String(err)] };
        }
    }

    async sendMsg(space: Space, message: string | MessageSegment | MessageSegment[]) {
        if (this.ws.readyState !== WebSocket.OPEN) {
            logger.warn("桌面客户端未连接，消息未发送");
            return;
        }
        const segments = (await Promise.all((Array.isArray(message) ? message : [message]).map((seg) => this.toFrameSegment(seg))))
            .flatMap((segs) => segs ?? []);
        if (segments.length === 0) return;
        const frameSpace: { from: string; id: string; conversationId?: string } = { from: space.from, id: space.id };
        if (space.conversationId) frameSpace.conversationId = space.conversationId;
        this.ws.send(JSON.stringify({ type: "message", space: frameSpace, segments }));
    }

    private async toFrameSegment(message: string | MessageSegment): Promise<MessageSegment[] | null> {
        // 字符串是 text 段的书写糖
        if (typeof message === "string") {
            return [{ type: "text", data: { text: message } }];
        }
        switch (message.type) {
            case "text":
                return [message];

            case "image":
            case "file": {
                const data = message.data as { media?: { uri?: string; localPath?: string }; name?: string };
                const media = normalizeMedia(data.media);
                const name = data.name ?? mediaBasename(media);
                if (media.localPath) {
                    const base64 = await readSendableMedia(media.localPath);
                    if (!base64) return null;
                    return [{ type: message.type, data: { media, name, base64, mime: mimeFromName(name) } }];
                }
                // http 链接原样透传，客户端自己加载
                if (media.uri) {
                    return [{ type: message.type, data: { media, name } }];
                }
                logger.warn("DesktopAdapter 发送媒体缺少 uri/localPath，跳过");
                return null;
            }

            case "tool_approval":
                // 门禁询问先以纯文本呈现；审批桥（core/api action 按钮化）落地后再上卡片
                return [{ type: "text", data: { text: renderApprovalNotice(toApprovalData(message.data)) } }];

            default:
                logger.warn("DesktopAdapter 暂不支持发送该消息段类型:", message.type);
                return null;
        }
    }
}

/** 读出待发送的本地媒体；超限/读不到返回 null，由调用方跳过 */
async function readSendableMedia(localPath: string): Promise<string | null> {
    const fullPath = resolveSendablePath(localPath);
    if (!fullPath) return null;
    try {
        const buf = await readFile(fullPath);
        if (buf.length > MAX_SEND_BYTES) {
            logger.warn(`桌面端发送媒体过大，已跳过: ${fullPath} (${buf.length} 字节)`);
            return null;
        }
        return buf.toString("base64");
    }
    catch (err) {
        logger.error("桌面端发送媒体读取失败:", err);
        return null;
    }
}
