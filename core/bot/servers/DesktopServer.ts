import { WebSocket, WebSocketServer } from "ws";
import config from "../../config.js";
import logger from "../../utils/logger.js";
import { extractToken, tokenMatches } from "../../utils/ws-auth.ts";
import BaseServer from "./BaseServer.ts";
import type { PlatformEventMeta } from "./BaseServer.ts";
import DesktopAdapter from "../adapters/DesktopAdapter.ts";
import { registerAdapter, unregisterAdapter } from "../../services/adapter-registry.js";
import { runtimeState } from "../../api/runtime-state.ts";
import { isPlaceholder } from "../../services/preflight.ts";
import type { CtxEvent, MessageSegment } from "../../types/index.ts";

/**
 * 占位协议帧：统一段直传，正式协议（握手版本号、chat.* 事件集）定型后替换
 */
interface DesktopFrame {
    type?: string;
    messageId?: string;
    userId?: string;
    nickName?: string;
    segments?: unknown;
}

/** 鉴权与 OneBot 接入共用 config.token；未配置（空 / your_xxx 模板）时不校验，由启动自检提示风险 */
const expectedToken = typeof config.token === "string" ? config.token.trim() : "";
const authEnabled = !isPlaceholder(expectedToken);

/** 桌面客户端接入服务器：自开 WS，桌面端主进程持客户端连接 */
class DesktopServer extends BaseServer<DesktopFrame> {
    private socket?: WebSocket;

    constructor(pipeline: (ctxEvent: CtxEvent) => Promise<void>) {
        super(pipeline);
    }

    start(): WebSocketServer {
        const wss = new WebSocketServer({
            port: config.desktopPort,
            /** 握手阶段鉴权：不通过直接回 401，连接根本不会进入 connection 回调 */
            verifyClient: (info, done) => {
                if (!authEnabled) {
                    done(true);
                    return;
                }
                const token = extractToken(info.req);
                if (token && tokenMatches(token, expectedToken)) {
                    done(true);
                    return;
                }
                logger.warn(`桌面端接入鉴权失败，已拒绝连接: ${info.req.socket.remoteAddress ?? "unknown"}`);
                done(false, 401, "Unauthorized");
            },
        });

        wss.on("connection", (ws, req) => {
            logger.info(`桌面客户端已连接 (端口: ${config.desktopPort}, 来源: ${req.socket.remoteAddress ?? "unknown"})`);
            runtimeState.desktopConnected = true;
            this.socket = ws;
            const adapter = new DesktopAdapter(this.pipeline, ws);
            this.adapter = adapter;
            // 主动链路（定时苏醒）需要拿到发送通道
            registerAdapter("desktop", adapter);

            ws.on("message", (data) => this.onRawMessage(data));

            ws.on("close", () => {
                logger.info("桌面客户端连接关闭");
                runtimeState.desktopConnected = false;
                if (this.socket === ws) this.socket = undefined;
                // 只在仍是本连接占位时摘除，避免重连时旧连接的关闭事件顶掉新实例
                if (this.adapter === adapter) {
                    unregisterAdapter("desktop", adapter);
                    this.adapter = undefined;
                }
            });

            ws.on("error", (err) => {
                logger.error("桌面客户端连接错误:", err);
            });
        });

        wss.on("listening", () => {
            logger.info(`DesktopServer 已启动: ws://0.0.0.0:${config.desktopPort}`);
            if (!authEnabled) {
                logger.warn("桌面端接入未启用鉴权（config.token 未配置），任何能连到该端口的客户端都可伪造消息注入");
            }
        });

        wss.on("error", (err) => {
            logger.error("DesktopServer 服务错误:", err);
        });

        return wss;
    }

    private async onRawMessage(data: unknown) {
        try {
            const frame = JSON.parse(String(data)) as DesktopFrame;
            logger.debug("收到桌面端消息:", frame);
            // 占位阶段只认消息帧，其余（握手 / 心跳）待正式协议定型
            if (frame.type !== "message") return;
            await this.dispatch(frame);
        }
        catch (err) {
            logger.error("解析桌面端消息 JSON 失败:", err);
        }
    }

    protected async toSegments(frame: DesktopFrame): Promise<MessageSegment[]> {
        // 统一段直传：客户端按 {type,data} 形状发，非法形状丢弃
        const raw = frame.segments;
        if (!Array.isArray(raw)) return [];
        return raw.flatMap((seg): MessageSegment[] => {
            if (!seg || typeof seg !== "object") return [];
            const { type, data } = seg as { type?: unknown; data?: unknown };
            if (typeof type !== "string" || type === "") return [];
            return [{ type, data: (data ?? {}) as MessageSegment["data"] }];
        });
    }

    protected toEventMeta(frame: DesktopFrame): PlatformEventMeta {
        // 桌面端是单用户通道：身份由客户端随消息携带，缺省给占位身份
        const userId = typeof frame.userId === "string" && frame.userId !== "" ? frame.userId : "desktop";
        return {
            space: { from: "user", id: userId, channel: "desktop" },
            userId,
            nickName: typeof frame.nickName === "string" && frame.nickName !== "" ? frame.nickName : "桌面用户",
            messageId: typeof frame.messageId === "string" ? frame.messageId : "",
        };
    }
}

export { DesktopServer };

export function startDesktopServer(pipeline: (ctxEvent: CtxEvent) => Promise<void>): WebSocketServer {
    return new DesktopServer(pipeline).start();
}
