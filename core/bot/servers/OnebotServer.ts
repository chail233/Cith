import { WebSocketServer } from "ws";
import type { IncomingMessage } from "node:http";
import crypto from "node:crypto";
import config from "../../config.js";
import logger from "../../utils/logger.js";
import BaseServer from "./BaseServer.ts";
import type { PlatformEventMeta } from "./BaseServer.ts";
import OnebotAdapter from "../adapters/OnebotAdapter.ts";
import { getImage } from "../../services/napcat.js";
import { runtimeState } from "../../api/runtime-state.ts";
import { registerAdapter, unregisterAdapter } from "../../services/adapter-registry.js";
import { isPlaceholder } from "../../services/preflight.ts";
import type { CtxEvent, MessageSegment } from "../../types/index.ts";
import type { MsgSegment } from "../../types/segment.ts";

interface OneBotSegment {
    type?: string;
    data?: Record<string, any>;
}

interface OneBotEvent {
    post_type?: string;
    message_type?: string;
    group_id?: string | number;
    user_id?: string | number;
    message_id?: string | number;
    message?: unknown;
    sender?: { nickname?: string };
}

const expectedToken = typeof config.token === "string" ? config.token.trim() : "";

/** token 未配置（空 / your_xxx 模板）时不校验，由启动自检提示风险；一旦配置则强制鉴权 */
const authEnabled = !isPlaceholder(expectedToken);


function extractToken(req: IncomingMessage): string {
    const header = req.headers.authorization ?? "";
    if (header.startsWith("Bearer ")) return header.slice(7).trim();
    try {
        return new URL(req.url ?? "/", "http://localhost").searchParams.get("access_token")?.trim() ?? "";
    }
    catch {
        return "";
    }
}

function tokenMatches(candidate: string): boolean {
    const given = crypto.createHash("sha256").update(candidate).digest();
    const expect = crypto.createHash("sha256").update(expectedToken).digest();
    return crypto.timingSafeEqual(given, expect);
}

/** OneBot 接入服务器：持有反向 WS 服务，连接建立时绑定发送适配器 */
class OnebotServer extends BaseServer<OneBotEvent> {

    constructor(pipeline: (ctxEvent: CtxEvent) => Promise<void>) {
        super(pipeline);
    }

    start(): WebSocketServer {
        const wss = new WebSocketServer({
            port: config.wsPort,
            path: "/onebot/v11/ws",
            /** 握手阶段鉴权：不通过直接回 401，连接根本不会进入 connection 回调 */
            verifyClient: (info, done) => {
                if (!authEnabled) {
                    done(true);
                    return;
                }
                const token = extractToken(info.req);
                if (token && tokenMatches(token)) {
                    done(true);
                    return;
                }
                logger.warn(`OneBot 接入鉴权失败，已拒绝连接: ${info.req.socket.remoteAddress ?? "unknown"}`);
                done(false, 401, "Unauthorized");
            },
        });

        wss.on("connection", (ws, req) => {
            logger.info(`NapCat 已连接 (端口: ${config.wsPort}, 来源: ${req.socket.remoteAddress ?? "unknown"})`);
            runtimeState.onebotConnected = true;
            this.adapter = new OnebotAdapter(this.pipeline, ws);
            // 主动链路（定时苏醒）需要拿到发送通道
            registerAdapter("onebot", this.adapter);

            ws.on("message", (data) => this.onRawMessage(data));

            ws.on("close", () => {
                logger.info("OnebotWebSocket 连接关闭");
                runtimeState.onebotConnected = false;
                if (this.adapter) unregisterAdapter("onebot", this.adapter);
                this.adapter = undefined;
            });

            ws.on("error", (err) => {
                logger.error("OnebotWebSocket 连接错误:", err);
            });

        });

        wss.on("listening", () => {
            logger.info(`OnebotWebSocket 服务已启动: ws://0.0.0.0:${config.wsPort}/onebot/v11/ws`);
            if (authEnabled) {
                logger.info("OneBot 接入鉴权已启用：握手需携带 NapCat token");
            }
            else {
                logger.warn("OneBot 接入未启用鉴权（config.token 未配置），任何能连到该端口的客户端都可伪造消息注入");
            }
        });

        wss.on("error", (err) => {
            logger.error("OnebotWebSocket 服务错误:", err);
        });

        return wss;
    }

    private async onRawMessage(data: unknown) {
        try {
            const event = JSON.parse(String(data)) as OneBotEvent;
            logger.debug("收到事件:", event);
            if (event.post_type !== "message") return;
            await this.dispatch(event);
        }
        catch (err) {
            logger.error("解析事件 JSON 失败:", err);
        }
    }

    protected async toSegments(event: OneBotEvent): Promise<MessageSegment[]> {
        const raw = event.message;
        // 只处理数组格式的消息，字符串格式与非法形状一律忽略
        if (!Array.isArray(raw)) return [];

        return Promise.all((raw as OneBotSegment[]).map(async (seg): Promise<MessageSegment> => {
            const d = seg.data ?? {};
            switch (seg.type) {
                case "text": {
                    const data: MsgSegment["text"] = { text: d.text ?? "" };
                    return { type: "text", data };
                }

                case "at": {
                    const id = String(d.qq ?? "");
                    const data: MsgSegment["mention"] = { id, isSelf: id === String(config.selfId ?? "") };
                    if (d.name) data.name = String(d.name);
                    else if (id === "all") data.name = "全体成员";
                    return { type: "mention", data };
                }

                case "image": {
                    const data: MsgSegment["image"] = {
                        media: { uri: d.url ?? "" },
                    };
                    // 收到图片时就地换出本地路径
                    const fileId = d.file;
                    if (typeof fileId === "string" && fileId !== "") {
                        const fileData = await getImage(fileId);
                        const localPath = fileData?.data?.file;
                        if (typeof localPath === "string" && localPath !== "") {
                            data.media.localPath = localPath;
                        }
                        else {
                            logger.warn(`NapCat get_image 未返回本地路径: ${fileId}`);
                        }
                    }
                    return { type: "image", data };
                }

                case "reply": {
                    const data: MsgSegment["reply"] = { id: String(d.id ?? "") };
                    return { type: "reply", data };
                }

                case "json": {
                    let title = "分享";
                    try {
                        const p = JSON.parse(d.data);
                        title = p?.meta?.detail_1?.title ?? p?.meta?.news?.title ?? "分享";
                    }
                    catch { /* 解析失败用兜底文案 */ }
                    const data: MsgSegment["link_card"] = { title };
                    return { type: "link_card", data };
                }

                // 官方链接分享段，与 json 卡片同为链接语义
                case "share": {
                    const data: MsgSegment["link_card"] = { title: d.title ?? "" };
                    if (d.url) data.url = String(d.url);
                    if (d.content) data.description = String(d.content);
                    return { type: "link_card", data };
                }

                default:
                    return { type: seg.type ?? "unknown", data: d };
            }
        }));
    }

    protected toEventMeta(event: OneBotEvent): PlatformEventMeta {
        return {
            space: event.message_type === "group"
                ? { from: "group", id: String(event.group_id ?? ""), channel: "onebot" }
                : { from: "user", id: String(event.user_id ?? ""), channel: "onebot" },
            userId: String(event.user_id ?? ""),
            nickName: event.sender?.nickname ?? "未知",
            messageId: String(event.message_id ?? ""),
        };
    }
}

export function startOneBotServer(pipeline: (ctxEvent: CtxEvent) => Promise<void>): WebSocketServer {
    return new OnebotServer(pipeline).start();
}
