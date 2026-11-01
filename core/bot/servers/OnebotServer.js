import { WebSocketServer } from "ws";
import crypto from "node:crypto";
import config from "../../config.js";
import logger from "../../utils/logger.js";
import OnebotAdapter from "../adapters/OnebotAdapter.ts";
import { runtimeState } from "../../api/runtime-state.ts";
import { registerAdapter, unregisterAdapter } from "../../services/adapter-registry.js";
import { isPlaceholder } from "../../services/preflight.ts";

/**
 * OneBot 反向 WS 鉴权
 */
const expectedToken = typeof config.token === "string" ? config.token.trim() : "";

/** token 未配置（空 / your_xxx 模板）时不校验，由启动自检提示风险；一旦配置则强制鉴权 */
const authEnabled = !isPlaceholder(expectedToken);

/**
 * 从握手请求提取凭证。
 * 优先 `Authorization: Bearer <token>`（OneBot v11 标准做法），
 * 兼容部分客户端使用的 `?access_token=` 查询参数形式。
 * @param {import("node:http").IncomingMessage} req
 * @returns {string}
 */
function extractToken(req) {
    const header = req.headers.authorization ?? "";
    if (header.startsWith("Bearer ")) return header.slice(7).trim();
    try {
        return new URL(req.url ?? "/", "http://localhost").searchParams.get("access_token")?.trim() ?? "";
    }
    catch {
        return "";
    }
}

/**
 * 恒定时间比较：两端先各自 sha256 拉平长度，
 * 避免长度差异导致的提前返回被用来逐位试探 token。
 * @param {string} candidate
 * @returns {boolean}
 */
function tokenMatches(candidate) {
    const given = crypto.createHash("sha256").update(candidate).digest();
    const expect = crypto.createHash("sha256").update(expectedToken).digest();
    return crypto.timingSafeEqual(given, expect);
}


export function startOneBotServer(pipeline) {
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
        const onebotAdapter = new OnebotAdapter(pipeline, ws);
        // 主动链路（定时苏醒）需要拿到发送通道
        registerAdapter("onebot", onebotAdapter);

        ws.on("message", (data) => {
            try {
                const event = JSON.parse(data.toString());
                logger.debug("收到事件:", event);
                if (event.post_type !== "message") return;
                const space = event.message_type === "group" ?
                    { from: "group", id: event.group_id.toString() } : { from: "user", id: event.user_id.toString() };
                const ctxEvent = {
                    adapter:onebotAdapter,
                    message:event.message,
                    space: space,
                    userId: event.user_id.toString(),
                    nickName:event.sender?.nickname ?? "未知"
                }
                const result = onebotAdapter.onMessage(ctxEvent);
            }
            catch (err) {
                logger.error("解析事件 JSON 失败:", err);
            }
        });

        ws.on("close", () => {
            logger.info("OnebotWebSocket 连接关闭");
            runtimeState.onebotConnected = false;
            unregisterAdapter("onebot", onebotAdapter);
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