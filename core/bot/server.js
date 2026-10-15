import { WebSocketServer } from "ws";
import config from "../config.js";
import logger from "../utils/logger.js";
import OnebotAdapter from "./adapter/OnebotAdapter.ts";
import { runtimeState } from "../api/runtime-state.ts";


export function startOneBotServer(pipeline) {
    const wss = new WebSocketServer({
        port: config.wsPort,
        path: "/onebot/v11/ws",
    });

    wss.on("connection", (ws) => {
        logger.info(`NapCat 已连接 (端口: ${config.wsPort})`);
        runtimeState.onebotConnected = true;
        const onebotAdapter = new OnebotAdapter(pipeline, ws);

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
            logger.info("WebSocket 连接关闭");
            runtimeState.onebotConnected = false;
        });

        ws.on("error", (err) => {
            logger.error("WebSocket 连接错误:", err);
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