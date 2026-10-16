import {WeChatBot} from "@wechatbot/wechatbot";
import type { Logger } from "@wechatbot/wechatbot";
import logger from "../../utils/logger.js";
import type { CtxEvent, Space } from "../../types/index.ts";
import WechatBotAdapter from "../adapters/WechatBotAdapter.ts";

export default async function startWechatBotServer(pipeline: (ctxEvent: CtxEvent) => Promise<void>) {
    const qrPrefix = "Scan this QR code in WeChat: ";
    // 自定义 SDK logger：首次登录二维码走 login callbacks，
    // 会话过期后 SDK 自动重登录不带 callbacks，二维码只会打到 logger，这里截获
    const sdkLogger: Logger = {
        debug: () => {},
        info: (message) => {
            if (message.startsWith(qrPrefix)) {
                logger.info(`WechatBot重新登录二维码: ${message.slice(qrPrefix.length)}`);
            }
        },
        warn: (message) => logger.warn("WechatBot SDK:", message),
        error: (message) => logger.error("WechatBot SDK:", message),
        child: () => sdkLogger,
    };

    const bot = new WeChatBot({
        storage: 'file',
        botAgent: 'SunbatwoBot',
        logger: sdkLogger,
    });

    const adapter = new WechatBotAdapter(pipeline, bot);

    bot.on('session:expired', () => logger.warn("WechatBot会话已过期，SDK正在自动重新登录，请等待新二维码"));
    bot.on('session:restored', () => logger.info("WechatBot重新登录成功"));

    bot.onMessage(async (msg) => {
        logger.info("WechatBot收到消息:", msg);
        if(msg.type==="text"){
            const space:Space = {
                from: "user",
                id: msg.userId,
            }
            const ctxEvent:CtxEvent = {
                adapter: adapter,
                message: [
                    {
                        type: "text",
                        data: { text: msg.text }
                    }
                ],
                space,
                userId: msg.userId,
                nickName: msg.userId,
            }
            const result = await adapter.onMessage(ctxEvent);
        }
    });

    await bot.login(
        {
            callbacks: {
                onScanned: () => logger.info("WechatBot已登录！"),
                onExpired: () => logger.info("WechatBot已过期！"),
                onQrUrl: (url) => logger.info(`WechatBot二维码: ${url}`),
            },
        }
    );
    logger.info("WechatBot已启动！");
    await bot.start()
}