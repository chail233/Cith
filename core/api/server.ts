import { WebSocketServer, WebSocket } from "ws";
import config from "../config.js";
import logger from "../utils/logger.js";
import { eventBus, FRAME_CHANNEL } from "./event-bus.ts";
import { dispatch } from "./router.ts";
import type { RequestFrame, EventFrame } from "./types.ts";
import "./actions/index.ts"; // 注册所有内置 action

/** 未认证连接必须在该时间内完成 auth，否则断开 */
const AUTH_TIMEOUT_MS = 5000;
/** 心跳周期 */
const HEARTBEAT_INTERVAL_MS = 30000;
const CLOSE_AUTH_TIMEOUT = 4001;
const CLOSE_UNAUTHORIZED = 4401;

interface ClientState {
    authenticated: boolean;
    isAlive: boolean;
    authTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * 启动面板 API 服务。
 * @returns WebSocketServer 实例，供进程退出时 close
 */
export function startApiServer(): WebSocketServer {
    const states = new WeakMap<WebSocket, ClientState>();

    const wss = new WebSocketServer({
        host: "127.0.0.1",
        port: config.web?.port ?? 2145,
        path: config.web?.path ?? "/api/v1/ws",
    });

    wss.on("listening", () => {
        logger.info(`面板 API 服务已启动: ws://127.0.0.1:${config.web?.port}${config.web?.path}`);
    });
    wss.on("error", (err) => {
        logger.error("面板 API 服务错误:", err);
    });

    // 订阅内部事件总线的广播帧，转发给所有已认证客户端
    eventBus.on(FRAME_CHANNEL, (frame: EventFrame) => {
        broadcast(wss, states, frame);
    });

    wss.on("connection", (ws: WebSocket) => {
        const state: ClientState = { authenticated: false, isAlive: true, authTimer: null };
        states.set(ws, state);

        // 超时未完成鉴权 → 强制关闭
        state.authTimer = setTimeout(() => {
            if (!state.authenticated) {
                logger.warn("面板连接鉴权超时，已断开");
                try { ws.close(CLOSE_AUTH_TIMEOUT, "auth timeout"); } catch { /* ignore */ }
            }
        }, AUTH_TIMEOUT_MS);

        ws.on("pong", () => { state.isAlive = true; });

        ws.on("message", (raw: Buffer) => {
            void handleMessage(ws, state, raw);
        });

        ws.on("close", () => {
            if (state.authTimer) clearTimeout(state.authTimer);
        });
        ws.on("error", (err) => {
            logger.error("面板连接错误:", err);
        });
    });

    // 心跳：周期性 ping 所有连接，上一轮无 pong 响应则判定为半开并终止
    const heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
            const state = states.get(ws);
            if (!state) continue;
            if (!state.isAlive) {
                ws.terminate();
                continue;
            }
            state.isAlive = false;
            ws.ping();
        }
    }, HEARTBEAT_INTERVAL_MS);

    // 进程关闭时随 wss 一起清理定时器，避免句柄泄漏
    wss.on("close", () => clearInterval(heartbeat));

    return wss;
}

/** 解析并处理一帧客户端消息 */
async function handleMessage(ws: WebSocket, state: ClientState, raw: Buffer): Promise<void> {
    let frame: RequestFrame;
    try {
        frame = JSON.parse(raw.toString());
    }
    catch {
        sendFrame(ws, { id: "", status: "error", message: "invalid json" });
        return;
    }

    // 鉴权帧：action === "auth"，携带 token
    if (!state.authenticated) {
        if (frame.action !== "auth" || frame.token !== config.web?.token) {
            logger.warn("面板连接鉴权失败，已断开");
            sendFrame(ws, { id: frame.id ?? "", status: "error", message: "unauthorized" });
            try { ws.close(CLOSE_UNAUTHORIZED, "unauthorized"); } catch { /* ignore */ }
            return;
        }
        state.authenticated = true;
        if (state.authTimer) { clearTimeout(state.authTimer); state.authTimer = null; }
        logger.info("面板连接已鉴权");
        sendFrame(ws, { id: frame.id ?? "auth", status: "ok", data: { authenticated: true } });
        return;
    }

    // 已鉴权：走白名单路由
    try {
        const data = await dispatch(frame.action, frame.params ?? {});
        sendFrame(ws, { id: frame.id, status: "ok", data: data ?? null });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendFrame(ws, { id: frame.id, status: "error", message });
    }
}

/** 向所有已认证且处于 OPEN 状态的连接广播事件帧 */
function broadcast(
    wss: WebSocketServer,
    states: WeakMap<WebSocket, ClientState>,
    frame: EventFrame,
): void {
    if (wss.clients.size === 0) return;
    const payload = JSON.stringify(frame);
    for (const ws of wss.clients) {
        const state = states.get(ws);
        if (!state?.authenticated) continue;
        if (ws.readyState !== WebSocket.OPEN) continue;
        try {
            ws.send(payload);
        }
        catch (err) {
            logger.error("面板事件发送失败:", err);
        }
    }
}

/** 安全发送一帧 */
function sendFrame(ws: WebSocket, frame: unknown): void {
    try {
        ws.send(JSON.stringify(frame));
    }
    catch (err) {
        logger.error("面板响应发送失败:", err);
    }
}
