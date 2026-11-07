import BaseAdapter from "./BaseAdapter.ts";
import type { CtxEvent, MessageSegment, Space } from "../../types/index.ts";
import logger from "../../utils/logger.js";
import { mediaBasename, resolveSendablePath } from "../../utils/segment-media.ts";
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
        for (const seg of segments) {
            try {
                await this.sendSegment(space.id, seg);
            }
            catch (err) {
                // 单段失败不中断同批后续段
                logger.error("WechatBot 发送消息段失败:", err);
            }
        }
    }

    /** 单个消息段 → 微信发送动作；SDK SendContent 仅支持文本/图片/文件/视频/链接，其余类型跳过 */
    private async sendSegment(userId: string, message: string | MessageSegment) {
        // 字符串是 text 段的书写糖
        if (typeof message === "string") {
            await this.bot.send(userId, message);
            logger.info("WechatBot 发送消息:", message);
            return;
        }
        switch (message.type) {
            case "text": {
                const text = message.data.text ?? "";
                await this.bot.send(userId, text);
                logger.info("WechatBot 发送消息:", text);
                return;
            }

            case "image": {
                const media = (message.data as { media?: MediaLike }).media;
                const localPath = media?.localPath ? resolveSendablePath(media.localPath) : null;
                if (localPath) {
                    const buffer = await readFile(localPath);
                    await this.bot.send(userId, { image: buffer });
                    logger.info(`WechatBot 发送图片: ${localPath} (${buffer.length} 字节)`);
                    return;
                }
                // SDK 的 url 变体会自行下载转发
                if (media?.uri) {
                    await this.bot.send(userId, { url: media.uri });
                    logger.info("WechatBot 发送图片(URL):", media.uri);
                    return;
                }
                return;
            }

            case "file": {
                const media = (message.data as { media?: MediaLike }).media;
                const name = (message.data as { name?: string }).name;
                const localPath = media?.localPath ? resolveSendablePath(media.localPath) : null;
                if (localPath) {
                    const buffer = await readFile(localPath);
                    await this.bot.send(userId, { file: buffer, fileName: name ?? mediaBasename(media) });
                    logger.info(`WechatBot 发送文件: ${localPath} (${buffer.length} 字节)`);
                    return;
                }
                if (media?.uri) {
                    await this.bot.send(userId, { url: media.uri, ...(name ? { fileName: name } : {}) });
                    logger.info("WechatBot 发送文件(URL):", media.uri);
                    return;
                }
                return;
            }

            case "mention":
                // 微信协议不支持 @ 消息段
                return;

            case "reply":
                // 微信协议不支持引用回复消息段
                return;

            default:
                logger.warn("WechatBotAdapter 暂不支持发送该消息段类型:", message.type);
        }
    }
}

interface MediaLike {
    uri?: string;
    localPath?: string;
}
