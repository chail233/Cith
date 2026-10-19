import BaseAdapter from "./BaseAdapter.ts";
import type { CtxEvent, Space } from "../../types/index.ts";
import logger from "../../utils/logger.js";
import {WeChatBot} from "@wechatbot/wechatbot";

export default class WechatBotAdapter extends BaseAdapter{
    private bot: WeChatBot;
    constructor(pipeline: (ctxEvent: CtxEvent) => Promise<void>, bot: WeChatBot) {
        super(pipeline);
        this.bot = bot;
    }

    async sendMsg(space:Space, message:object[]|object|string) {
        try {
            if (typeof message === "string") {
                await this.bot.send(space.id, message);
                logger.info("WechatBot 发送消息:", message);
            }
            else {
                logger.warn("WechatBot 暂不支持该消息类型:", JSON.stringify(message));
            }
        }
        catch (err) {
            logger.error("WechatBot 发送失败:", err);
        }
    }
}
