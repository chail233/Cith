import BaseAdapter from "./BaseAdapter.ts";
import type { CtxEvent, MessageSegment, Space } from "../../types/index.ts";
import logger from "../../utils/logger.js";
import { readFile } from "node:fs/promises";
import {WeChatBot} from "@wechatbot/wechatbot";

export default class WechatBotAdapter extends BaseAdapter{
    private bot: WeChatBot;
    constructor(pipeline: (ctxEvent: CtxEvent) => Promise<void>, bot: WeChatBot) {
        super(pipeline);
        this.bot = bot;
    }

    async sendMsg(space:Space, message: string | MessageSegment | MessageSegment[]) {
        const segments = Array.isArray(message) ? message : [message];
        try {
            for (const seg of segments) {
                await this.sendSegment(space.id, seg);
            }
        }
        catch (err) {
            logger.error("WechatBot 发送失败:", err);
        }
    }

    /** 单个消息段 → 微信发送动作 */
    private async sendSegment(userId: string, message: string | MessageSegment) {
        // 字符串是 text 段的书写糖
        if (typeof message === "string") {
            await this.bot.send(userId, message);
            logger.info("WechatBot 发送消息:", message);
            return;
        }
        if (message.type === "text") {
            const text = message.data.text ?? "";
            await this.bot.send(userId, text);
            logger.info("WechatBot 发送消息:", text);
            return;
        }
        if (message.type === "image") {
            const media = (message.data as { media?: { localPath?: string } }).media;
            if (!media?.localPath) {
                logger.warn("WechatBotAdapter 发送图片缺少 localPath，跳过");
                return;
            }
            const buffer = await readFile(media.localPath);
            await this.bot.send(userId, { image: buffer });
            logger.info(`WechatBot 发送图片: ${media.localPath} (${buffer.length} 字节)`);
            return;
        }
        logger.warn("WechatBotAdapter 暂不支持发送该消息段类型:", message.type);
    }
}
