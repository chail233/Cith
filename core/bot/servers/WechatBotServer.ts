import {WeChatBot} from "@wechatbot/wechatbot";
import type { Logger } from "@wechatbot/wechatbot";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import config from "../../config.js";
import logger from "../../utils/logger.js";
import type { CtxEvent, Space } from "../../types/index.ts";
import WechatBotAdapter from "../adapters/WechatBotAdapter.ts";
import { registerAdapter, unregisterAdapter } from "../../services/adapter-registry.js";

/** 项目根：源码在 core/bot/servers、构建产物在 dist/bot/servers，向上三级都落到项目根 */
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function resolveWechatStorageDir(raw: unknown): string | undefined {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text === "") return undefined;
    if (text === "~") return homedir();
    if (text.startsWith("~/") || text.startsWith("~\\")) return join(homedir(), text.slice(2));
    return isAbsolute(text) ? text : resolve(PROJECT_ROOT, text);
}

export default async function startWechatBotServer(pipeline: (ctxEvent: CtxEvent) => Promise<void>) {
    const qrPrefix = "Scan this QR code in WeChat: ";
    // 自定义 SDK logger：首次登录二维码走 login callbacks，
    // 会话过期后 SDK 自动重登录不带 callbacks，二维码只会打到 logger，这里截获
    const sdkLogger: Logger = {
        debug: () => {},
        info: (message) => {
            if (message.startsWith(qrPrefix)) {
                logger.info(`WechatBot重新登录二维码: ${message.slice(qrPrefix.length)}`);
                return;
            }
            // 其余 info 转 debug：登录阶段（读取凭证 / 请求二维码 / 确认 / 落盘）全靠这些行判断进度
            logger.debug("WechatBot SDK:", message);
        },
        warn: (message) => logger.warn("WechatBot SDK:", message),
        error: (message) => logger.error("WechatBot SDK:", message),
        child: () => sdkLogger,
    };

    const storageDir = resolveWechatStorageDir(
        (config as { wechatStorageDir?: unknown }).wechatStorageDir,
    );
    const bot = new WeChatBot({
        storage: 'file',
        botAgent: 'SunbatwoBot',
        logger: sdkLogger,
        ...(storageDir ? { storageDir } : {}),
    });
    logger.info(`WechatBot凭证目录: ${storageDir ?? join(homedir(), ".wechatbot")}`);

    const adapter = new WechatBotAdapter(pipeline, bot);
    registerAdapter("wechat", adapter);

    bot.on('session:expired', () => {
        unregisterAdapter("wechat", adapter);
        logger.warn("WechatBot会话已过期，SDK正在自动重新登录，请等待新二维码");
    });
    bot.on('session:restored', () => {
        registerAdapter("wechat", adapter);
        logger.info("WechatBot重新登录成功");
    });

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

    // 是否走过扫码：login 会优先复用已保存凭证，此时不会有任何二维码
    let qrShown = false;
    const creds = await bot.login(
        {
            callbacks: {
                onScanned: () => logger.info("WechatBot已登录！"),
                onExpired: () => logger.info("WechatBot已过期！"),
                onQrUrl: (url) => {
                    qrShown = true;
                    logger.info(`WechatBot二维码: ${url}`);
                },
            },
        }
    );
    logger.info(
        `WechatBot已启动！账号 ${creds.accountId}，${qrShown ? "本次扫码登录" : "复用已保存凭证（无需扫码）"}`,
    );
    await bot.start()
}