import { WebSocketServer } from "ws";
import config from "../config.js";
import logger from "../utils/logger.js";
import { OneBotAdapter } from "./adapter/adapter.js";

/**
 * 启动 OneBot WebSocket 服务
 * NapCat 作为客户端连接到此服务
 *
 * @param {(event: object, adapter: OneBotAdapter) => void | Promise<void>} onEvent
 *   事件处理回调，收到事件时调用
 * @returns {Promise<WebSocketServer>} WebSocket 服务器实例
 */
export function startOneBotServer(onEvent) {
    const wss = new WebSocketServer({
        port: config.wsPort,
        path: "/onebot/v11/ws",
    });

    wss.on("connection", (ws) => {
        logger.info(`NapCat 已连接 (端口: ${config.wsPort})`);

        const adapter = new OneBotAdapter(ws);

        adapter.onEvent(async (event) => {
            try {
                await onEvent(event, adapter);
            }
            catch (err) {
                logger.error("事件处理出错:", err);
            }
        });
    });

    wss.on("listening", () => {
        logger.info(`WebSocket 服务已启动: ws://0.0.0.0:${config.wsPort}/onebot/v11/ws`);
    });

    wss.on("error", (err) => {
        logger.error("WebSocket 服务错误:", err);
    });

    return wss;
}