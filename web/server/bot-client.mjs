/**
 * BotApiClient —— BFF 与 Bot 内置面板 API 服务之间的 WS 客户端。
 *
 */
import WebSocket from "ws";

/** 单个请求的超时时间，避免 Bot 未回包时 Promise 永久悬挂 */
const REQUEST_TIMEOUT_MS = 10_000;
/** 重连退避基数与上限 */
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;
/** Bot 关闭码：鉴权超时 */
const CLOSE_AUTH_TIMEOUT = 4001;
/** Bot 关闭码：未授权 */
const CLOSE_UNAUTHORIZED = 4401;

/**
 * @typedef {Object} EventFrame
 * @property {"event"} type
 * @property {string} event
 * @property {number} ts
 * @property {unknown} data
 */

export class BotApiClient {
    /**
     * @param {{ url: string, token: string, log?: (level: string, msg: string) => void }} opts
     */
    constructor({ url, token, log = () => {} }) {
        this.url = url;
        this.token = token;
        this.log = log;

        /** @type {WebSocket | null} */
        this.ws = null;
        this.authenticated = false;
        this.connected = false;

        this.seq = 0;
        /** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout, action: string }>} */
        this.pending = new Map();
        /** 已收到的最大事件时间戳，重连后作为 get_logs 的 since 补拉 */
        this.lastTs = 0;

        /** @type {Set<(frame: EventFrame) => void>} */
        this.eventListeners = new Set();
        this.reconnectTimer = null;
        this.reconnectAttempt = 0;
        this.stopped = false;
    }

    /** 建立连接并启动鉴权/重连循环 */
    connect() {
        this.stopped = false;
        this.#open();
    }

    /** 停止客户端并清理所有定时器 */
    stop() {
        this.stopped = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.#failPending(new Error("client stopped"));
        try { this.ws?.close(); } catch { /* ignore */ }
        this.ws = null;
        this.connected = false;
        this.authenticated = false;
    }

    /** 调用一个 action，返回 Promise<data>；未连接/未鉴权时立即失败 */
    call(action, params = {}) {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error("Bot 未连接"));
                return;
            }
            const id = `w${Date.now().toString(36)}-${this.seq++}`;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`请求超时: ${action}`));
            }, REQUEST_TIMEOUT_MS);
            this.pending.set(id, { resolve, reject, timer, action });
            try {
                this.ws.send(JSON.stringify({ id, action, params }));
            }
            catch (err) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });
    }

    /** 注册事件帧监听器，返回取消注册函数 */
    onEvent(listener) {
        this.eventListeners.add(listener);
        return () => this.eventListeners.delete(listener);
    }

    #open() {
        this.log("info", `连接 Bot API: ${this.url}`);
        const ws = new WebSocket(this.url);
        this.ws = ws;

        ws.on("open", () => {
            this.connected = true;
            void this.#auth();
        });

        ws.on("message", (raw) => {
            try {
                this.#onFrame(JSON.parse(raw.toString()));
            }
            catch {
                // Bot 对非法 JSON 才会回 id 为空串的 error 帧；BFF 自身只发合法 JSON，忽略解析失败帧
            }
        });

        ws.on("close", (code) => this.#onClose(code));
        ws.on("error", (err) => {
            this.log("warn", `Bot 连接错误: ${err.message}`);
        });
    }

    async #auth() {
        try {
            const data = await this.#sendAuth();
            if (!data?.authenticated) return; // 异常响应由 close 回调统一处理重连
        }
        catch {
            return; // 鉴权失败/超时，等待 close 触发重连
        }
        this.authenticated = true;
        this.reconnectAttempt = 0;
        this.log("info", "Bot 鉴权成功");
        await this.#catchUp();
    }

    /** 发送裸 auth 帧（token 是顶层字段，不能走通用 call()），返回 Promise<data> */
    #sendAuth() {
        return new Promise((resolve, reject) => {
            const id = `auth-${this.seq++}`;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error("auth timeout"));
            }, REQUEST_TIMEOUT_MS);
            this.pending.set(id, { resolve, reject, timer, action: "auth" });
            try {
                this.ws.send(JSON.stringify({ id, action: "auth", token: this.token }));
            }
            catch (err) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });
    }

    /** 断线补拉：用 lastTs 作为 since 拉取断开期间遗漏的事件，并照常分发给监听者 */
    async #catchUp() {
        try {
            const events = await this.call("get_logs", { since: this.lastTs, limit: 1000 });
            if (!Array.isArray(events)) return;
            for (const frame of events) {
                if (frame && typeof frame.ts === "number" && frame.ts > this.lastTs) {
                    this.lastTs = frame.ts;
                }
                for (const listener of this.eventListeners) {
                    try { listener(frame); } catch { /* ignore */ }
                }
            }
        } catch {
            // 补拉失败不阻塞正常运行，等下次重连再补
        }
    }

    #onFrame(frame) {
        // 事件帧：更新 lastTs 并分发
        if (frame && frame.type === "event") {
            if (typeof frame.ts === "number" && frame.ts > this.lastTs) {
                this.lastTs = frame.ts;
            }
            for (const listener of this.eventListeners) {
                try { listener(frame); } catch { /* 单个监听器异常不反噬其它监听者 */ }
            }
            return;
        }

        // 响应帧：按 id 结算；id 为空串（invalid json 兜底帧）不会命中任何挂起请求
        const p = frame && typeof frame.id === "string" ? this.pending.get(frame.id) : undefined;
        if (!p) return;
        this.pending.delete(frame.id);
        clearTimeout(p.timer);
        if (frame.status === "ok") {
            p.resolve(frame.data ?? null);
        }
        else {
            p.reject(new Error(frame.message || "api error"));
        }
    }

    #onClose(code) {
        this.connected = false;
        this.authenticated = false;
        this.#failPending(new Error("连接已关闭"));
        if (this.stopped) return;

        if (code === CLOSE_AUTH_TIMEOUT) {
            this.log("error", "Bot 关闭连接：鉴权超时(4001)");
        } else if (code === CLOSE_UNAUTHORIZED) {
            this.log("error", "Bot 关闭连接：token 错误(4401)，请检查 BOT_PANEL_TOKEN");
        } else if (code) {
            this.log("warn", `Bot 连接关闭(code=${code})，准备重连`);
        }

        const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_MS);
        this.reconnectAttempt += 1;
        this.reconnectTimer = setTimeout(() => this.#open(), delay);
        this.log("info", `${delay}ms 后第 ${this.reconnectAttempt} 次重连`);
    }

    #failPending(err) {
        for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(err);
        }
        this.pending.clear();
    }
}
