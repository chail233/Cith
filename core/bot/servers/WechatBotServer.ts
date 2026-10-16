import {WeChatBot} from "@wechatbot/wechatbot";
import logger from "../../utils/logger.js";
import type { CtxEvent, Space } from "../../types/index.ts";
import WechatBotAdapter from "../adapters/WechatBotAdapter.ts";

export default async function startWechatBotServer(pipeline: (ctxEvent: CtxEvent) => Promise<void>) {
    const bot = new WeChatBot({
        storage: 'file',            // 'file' | 'memory' | 自定义 Storage
        logLevel: 'silent',           // 'debug' | 'info' | 'warn' | 'error' | 'silent'
        botAgent: 'SunbatwoBot', // 随每个请求发送的 base_info.bot_agent 标识
    });

    const adapter = new WechatBotAdapter(pipeline, bot);

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