import logger from "../utils/logger.js";
/**
 * 消息适配器
 * 包装一个 WebSocket 连接，提供事件接收和动作发送的抽象接口
 */
export class OneBotAdapter {
    /**
     * @param {import("ws").WebSocket} ws 原始 WebSocket 连接
     */
    constructor(ws) {
        this.ws = ws;
        this._eventHandler = null;
        this._closed = false;

        ws.on("message", (data) => {
            try {
                const event = JSON.parse(data.toString());
                logger.debug("收到事件:", event);
                if (event.post_type !== "message") return;
                const space = event.message_type === "group" ?
                    { from: "group", id: event.group_id.toString() } : { from: "user", id: event.user_id.toString() };
                const ctxEvent = {
                    adapter:this,
                    message:event.message,
                    space: space,
                    userId: event.user_id.toString(),
                    nickName:event.sender?.nickname ?? "未知"
                }
                if (this._eventHandler) {
                    this._eventHandler(ctxEvent);
                }
            }
            catch (err) {
                logger.error("解析事件 JSON 失败:", err);
            }
        });

        ws.on("close", () => {
            logger.info("WebSocket 连接关闭");
            this._closed = true;
        });

        ws.on("error", (err) => {
            logger.error("WebSocket 连接错误:", err);
        });
    }

    /**
     * 注册事件处理器
     * @param {(event: object) => void | Promise<void>} handler
     */
    onEvent(handler) {
        this._eventHandler = handler;
    }

    /**
     * 发送 OneBot 动作
     * @param {{action: string, params: object, echo?: string}} actionObj
     */
    sendAction(actionObj) {
        if (this._closed) {
            logger.warn("连接已关闭，无法发送动作:", actionObj.action);
            return;
        }
        const payload = JSON.stringify(actionObj);
        logger.debug("发送动作:", actionObj.action);
        this.ws.send(payload);
    }

    /**
     * 发送消息
     * @param {object} space
     * @param {string|object|Array} message
     */
    sendMsg(space, message) {
        this.sendAction({
            action: "send_msg",
            params: {
                message_type: space.from==="group" ? "group" : "private",
                group_id: space.from==="group"? space.id : null,
                user_id: space.from==="user"?space.id : null,
                message
            },
        });
    }
}