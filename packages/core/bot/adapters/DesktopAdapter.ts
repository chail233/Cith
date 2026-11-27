import { readFile } from "node:fs/promises";
import BaseAdapter from "./BaseAdapter.ts";
import type { CtxEvent, MessageSegment, Space, ToolExecutionEvent } from "../../types/index.ts";
import { FINISH_TURN_TOOL_NAME } from "../../agent/tools/finish-turn.ts";
import logger from "../../utils/logger.js";
import { renderApprovalNotice, toApprovalData } from "../../utils/approval-notice.ts";
import { mediaBasename, normalizeMedia, resolveSendablePath } from "../../utils/segment-media.ts";
import { WebSocket } from "ws";
import { fileCap, imageCap, textCap } from "./reply-segment-caps.ts";
import type { ReplyDelivery, ReplySegmentCap } from "./reply-tool.ts";

/** 桌面客户端能力：本地图片以二进制随消息发送，网络图片透传链接 */
const DESKTOP_CAPS: ReplySegmentCap[] = [textCap(), imageCap(), fileCap()];

/** 单个本地媒体的原始字节数上限，超出跳过 */
const MAX_SEND_BYTES = 50 * 1024 * 1024;
const MAX_TOOL_OUTPUT_CHARS = 8_000;

type DesktopFrameSegment = { segment: MessageSegment; image?: Buffer };

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

    sendToolEvent(space: Space, event: ToolExecutionEvent): void {
        if (space.channel !== this.channel || !space.conversationId || this.ws.readyState !== WebSocket.OPEN) return;
        if (event.toolName === FINISH_TURN_TOOL_NAME) return;
        const frameSpace = { id: space.id, conversationId: space.conversationId };
        if (event.type === "tool.end" && event.output.length > MAX_TOOL_OUTPUT_CHARS) {
            const output = `${event.output.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n…（结果已截断）`;
            this.ws.send(JSON.stringify({ ...event, space: frameSpace, output }));
        } else {
            this.ws.send(JSON.stringify({ ...event, space: frameSpace }));
        }
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
        const parts = await Promise.all((Array.isArray(message) ? message : [message]).map((seg) => this.toFrameSegment(seg)));
        const segments: MessageSegment[] = [];
        const images: Buffer[] = [];
        for (const part of parts) {
            if (!part) continue;
            segments.push(part.segment);
            if (part.image) images.push(part.image);
        }
        if (segments.length === 0) return;
        const frameSpace: { from: string; id: string; conversationId?: string } = { from: space.from, id: space.id };
        if (space.conversationId) frameSpace.conversationId = space.conversationId;
        const json = JSON.stringify({ type: "message", space: frameSpace, segments });
        if (images.length === 0) {
            this.ws.send(json);
            return;
        }
        // 二进制消息：4 字节大端头部长度、UTF-8 JSON 头部、按段顺序拼接的图片字节。
        const header = Buffer.from(json, "utf8");
        const headerLength = Buffer.alloc(4);
        headerLength.writeUInt32BE(header.length);
        this.ws.send(Buffer.concat([headerLength, header, ...images]));
    }

    private async toFrameSegment(message: string | MessageSegment): Promise<DesktopFrameSegment | null> {
        if (typeof message === "string") {
            return { segment: { type: "text", data: { text: message } } };
        }
        switch (message.type) {
            case "text":
                return { segment: message };

            case "image":
            case "file": {
                const data = message.data as { media?: { uri?: string; localPath?: string }; name?: string };
                const media = normalizeMedia(data.media);
                const name = data.name ?? mediaBasename(media);
                if (media.localPath) {
                    const bytes = await readSendableMedia(media.localPath);
                    if (!bytes?.length) return null;
                    const mime = mimeFromName(name);
                    if (message.type === "image") {
                        return {
                            segment: { type: "image", data: { media, name, mime, binaryLength: bytes.length } },
                            image: bytes,
                        };
                    }
                    return { segment: { type: "file", data: { media, name, mime, base64: bytes.toString("base64") } } };
                }
                // http 链接原样透传，客户端自己加载
                if (media.uri) {
                    return { segment: { type: message.type, data: { media, name } } };
                }
                logger.warn("DesktopAdapter 发送媒体缺少 uri/localPath，跳过");
                return null;
            }

            case "tool_approval":
                // 门禁询问先以纯文本呈现；审批桥（core/api action 按钮化）落地后再上卡片
                return { segment: { type: "text", data: { text: renderApprovalNotice(toApprovalData(message.data)) } } };

            default:
                logger.warn("DesktopAdapter 暂不支持发送该消息段类型:", message.type);
                return null;
        }
    }
}

/** 读出待发送的本地媒体；超限/读不到返回 null，由调用方跳过 */
async function readSendableMedia(localPath: string): Promise<Buffer | null> {
    const fullPath = resolveSendablePath(localPath);
    if (!fullPath) return null;
    try {
        const buf = await readFile(fullPath);
        if (buf.length > MAX_SEND_BYTES) {
            logger.warn(`桌面端发送媒体过大，已跳过: ${fullPath} (${buf.length} 字节)`);
            return null;
        }
        return buf;
    }
    catch (err) {
        logger.error("桌面端发送媒体读取失败:", err);
        return null;
    }
}
