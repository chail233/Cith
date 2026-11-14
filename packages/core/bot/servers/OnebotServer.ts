import { WebSocket, WebSocketServer } from "ws";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import config from "../../config.js";
import logger from "../../utils/logger.js";
import { extractToken, tokenMatches } from "../../utils/ws-auth.ts";
import BaseServer from "./BaseServer.ts";
import type { PlatformEventMeta } from "./BaseServer.ts";
import OnebotAdapter from "../adapters/OnebotAdapter.ts";
import { saveMediaFile } from "../../utils/media-store.ts";
import { runtimeState } from "../../api/runtime-state.ts";
import { registerAdapter, unregisterAdapter } from "../../services/adapter-registry.js";
import { isPlaceholder } from "../../services/preflight.ts";
import type { CtxEvent, MessageSegment } from "../../types/index.ts";
import type { MediaRef } from "../../types/segment.ts";

/** 入站语音落地目录（相对于 core/） */
const VOICE_DIR = "data/voices";

/** 动作 RPC 等回包超时 */
const ACTION_TIMEOUT_MS = 10_000;

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

/** OneBot 动作回包帧（data 形状随 action 而异） */
interface ActionResponse {
    status?: string;
    retcode?: number;
    data?: any;
}

const expectedToken = typeof config.token === "string" ? config.token.trim() : "";

/** token 未配置（空 / your_xxx 模板）时不校验，由启动自检提示风险；一旦配置则强制鉴权 */
const authEnabled = !isPlaceholder(expectedToken);

/**
 * 语音落地：get_record 会给出转码后的 base64 与本机路径
 * 优先用 base64 写进 core/data/voices/（NapCat 与本进程不同机或跑在容器里时，它的本机路径读不到）；
 * 拿不到 base64 才退回直接引用那个本机路径
 * @returns 落地/可读的绝对路径；两者都不可用时为 undefined
 */
async function saveVoiceFile(base64: unknown, napcatPath: unknown): Promise<string | undefined> {
    if (typeof base64 === "string" && base64 !== "") {
        try {
            const buf = Buffer.from(base64, "base64");
            const localPath = await saveMediaFile(VOICE_DIR, buf, "voice", "mp3");
            logger.info(`语音已落地: ${localPath} (${buf.length} 字节)`);
            return localPath;
        }
        catch (err) {
            logger.error("语音落地失败:", err);
        }
    }
    if (typeof napcatPath === "string" && napcatPath !== "" && existsSync(napcatPath)) {
        return napcatPath;
    }
    return undefined;
}

/** OneBot 发来的语音段时长（秒）；字段缺失或非正数时返回 undefined */
function voiceDuration(raw: unknown): number | undefined {
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/** OneBot 接入服务器：持有反向 WS 服务，连接建立时绑定发送适配器 */
class OnebotServer extends BaseServer<OneBotEvent> {
    private socket?: WebSocket;
    /** 在途动作：echo → 收尾项（回包认领 / 超时 / 断线统一在这里了结） */
    private readonly pending = new Map<string, { resolve: (resp: ActionResponse | null) => void; timer: NodeJS.Timeout }>();

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
                if (token && tokenMatches(token, expectedToken)) {
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
            this.socket = ws;
            const adapter = new OnebotAdapter(this.pipeline, ws);
            this.adapter = adapter;
            // 主动链路（定时苏醒）需要拿到发送通道
            registerAdapter("onebot", adapter);

            ws.on("message", (data) => this.onRawMessage(data));

            ws.on("close", () => {
                logger.info("OnebotWebSocket 连接关闭");
                runtimeState.onebotConnected = false;
                if (this.socket === ws) this.socket = undefined;
                // 旧连接上的在途动作永远等不到回包了，统一按失败收尾
                this.failPending();
                // 只在仍是本连接占位时摘除，避免重连时旧连接的关闭事件顶掉新实例
                if (this.adapter === adapter) {
                    unregisterAdapter("onebot", adapter);
                    this.adapter = undefined;
                }
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
            const frame = JSON.parse(String(data)) as OneBotEvent & { echo?: string; status?: string };
            logger.debug("收到事件:", frame);
            // 动作回包按 echo 认领；事件帧不带 echo，认领不了才走事件分发
            if (typeof frame.echo === "string" && this.pending.has(frame.echo)) {
                const entry = this.pending.get(frame.echo)!;
                // NapCat 受理慢动作时先回 status:"async"，最终结果稍后以同一个 echo 补发
                if (frame.status === "async") return;
                this.pending.delete(frame.echo);
                clearTimeout(entry.timer);
                entry.resolve(frame);
                return;
            }
            if (frame.post_type !== "message") return;
            await this.dispatch(frame);
        }
        catch (err) {
            logger.error("解析事件 JSON 失败:", err);
        }
    }

    /**
     * 动作 RPC：经反向 WS 下发 OneBot action，按 echo 等回包
     * 无连接 / 发送失败 / 超时 / 断线统一 resolve null，由调用方按各自语义降级
     */
    private callAction(action: string, params: Record<string, unknown>, quiet = false): Promise<ActionResponse | null> {
        return new Promise((resolve) => {
            const socket = this.socket;
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                logger[quiet ? "warn" : "error"](`NapCat 未连接，动作未执行 [${action}]`);
                resolve(null);
                return;
            }
            const echo = crypto.randomUUID();
            const timer = setTimeout(() => {
                const entry = this.pending.get(echo);
                if (!entry) return;
                this.pending.delete(echo);
                logger[quiet ? "warn" : "error"](`NapCat 动作响应超时 [${action}]`);
                entry.resolve(null);
            }, ACTION_TIMEOUT_MS);
            this.pending.set(echo, { resolve, timer });
            try {
                socket.send(JSON.stringify({ action, params, echo }));
            }
            catch (err) {
                this.pending.delete(echo);
                clearTimeout(timer);
                logger.error(`NapCat 动作发送失败 [${action}]:`, err);
                resolve(null);
            }
        });
    }

    /** 连接断开：清空在途动作，全部按 null 收尾 */
    private failPending(): void {
        for (const entry of this.pending.values()) {
            clearTimeout(entry.timer);
            entry.resolve(null);
        }
        this.pending.clear();
    }

    protected async toSegments(event: OneBotEvent): Promise<MessageSegment[]> {
        const raw = event.message;
        // 只处理数组格式的消息，字符串格式与非法形状一律忽略
        if (!Array.isArray(raw)) return [];

        return Promise.all((raw as OneBotSegment[]).map(async (seg): Promise<MessageSegment> => {
            const d = seg.data ?? {};
            switch (seg.type) {
                case "text":
                    return { type: "text", data: { text: d.text ?? "" } };

                case "at": {
                    const id = String(d.qq ?? "");
                    const isSelf = id === String(config.selfId ?? "");
                    // NapCat 只部分场景给昵称；@自己固定叫"我"，@全体成员用固定文案
                    const name = isSelf ? "我" : d.name ? String(d.name) : (id === "all" ? "全体成员" : "");
                    return {
                        type: "mention",
                        data: {
                            id,
                            isSelf,
                            ...(name === "" ? {} : { name }),
                        },
                    };
                }

                case "image": {
                    const media: MediaRef = { uri: d.url ?? "" };
                    // 收到图片时就地换出本地路径
                    const fileId = d.file;
                    if (typeof fileId === "string" && fileId !== "") {
                        const fileData = await this.callAction("get_image", { file: fileId });
                        const localPath = fileData?.data?.file;
                        if (typeof localPath === "string" && localPath !== "") {
                            media.localPath = localPath;
                        }
                        else {
                            logger.warn(`NapCat get_image 未返回本地路径: ${fileId}`);
                        }
                    }
                    // NapCat 的 summary 通常是表情/图片名（如 "[动画表情]"），模型无需识图也能得体回应
                    const alt = typeof d.summary === "string" && d.summary !== "" ? d.summary : "";
                    return { type: "image", data: alt === "" ? { media } : { media, alt } };
                }

                case "record": {
                    // 语音：取转码后的音频文件 + QQ 原生转写文本，两者并行，任一路失败都只降级
                    const media: MediaRef = { uri: d.url ?? "" };
                    const fileId = typeof d.file === "string" ? d.file : "";
                    const messageId = String(event.message_id ?? "");
                    const [record, ptt] = await Promise.all([
                        fileId === "" ? Promise.resolve(null) : this.callAction("get_record", { file: fileId, out_format: "mp3" }),
                        messageId === "" ? Promise.resolve(null) : this.callAction("fetch_ptt_text", { message_id: messageId }, true),
                    ]);
                    const text = typeof ptt?.data?.text === "string" ? ptt.data.text : "";
                    const localPath = await saveVoiceFile(record?.data?.base64, record?.data?.file);
                    if (localPath) media.localPath = localPath;
                    const duration = voiceDuration(d.duration);
                    return {
                        type: "voice",
                        data: {
                            media,
                            ...(duration === undefined ? {} : { duration }),
                            ...(text === "" ? {} : { text }),
                        },
                    };
                }

                case "reply":
                    return { type: "reply", data: { id: String(d.id ?? "") } };

                case "json": {
                    let title = "分享";
                    try {
                        const p = JSON.parse(d.data);
                        title = p?.meta?.detail_1?.title ?? p?.meta?.news?.title ?? "分享";
                    }
                    catch { /* 解析失败用兜底文案 */ }
                    return { type: "link_card", data: { title } };
                }

                // 官方链接分享段，与 json 卡片同为链接语义
                case "share":
                    return {
                        type: "link_card",
                        data: {
                            title: d.title ?? "",
                            ...(d.url ? { url: String(d.url) } : {}),
                            ...(d.content ? { description: String(d.content) } : {}),
                        },
                    };

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

export { OnebotServer };

export function startOneBotServer(pipeline: (ctxEvent: CtxEvent) => Promise<void>): WebSocketServer {
    return new OnebotServer(pipeline).start();
}
