import {WeChatBot} from "@wechatbot/wechatbot";
import type { IncomingMessage, Logger } from "@wechatbot/wechatbot";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import config from "../../config.js";
import logger from "../../utils/logger.js";
import { resolveSrcPath } from "../../utils/file-security.js";
import type { CtxEvent, MessageSegment, Space } from "../../types/index.ts";
import WechatBotAdapter from "../adapters/WechatBotAdapter.ts";
import { registerAdapter, unregisterAdapter } from "../../services/adapter-registry.js";

/** 项目根：源码在 core/bot/servers、构建产物在 dist/bot/servers，向上三级都落到项目根 */
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** 微信图片落地目录（相对于 core/，与 rememori 同级） */
const WECHAT_IMAGE_DIR = "data/images";

async function saveImageFile(buf: Buffer): Promise<string> {
    const resolved = resolveSrcPath(WECHAT_IMAGE_DIR);
    if (resolved.error || !resolved.fullPath) {
        throw new Error(`图片目录路径非法: ${resolved.error ?? WECHAT_IMAGE_DIR}`);
    }
    await mkdir(resolved.fullPath, { recursive: true });
    const fileName = `wechat-${Date.now()}-${randomBytes(4).toString("hex")}.img`;
    const fullPath = join(resolved.fullPath, fileName);
    await writeFile(fullPath, buf);
    return fullPath;
}


async function toSegments(bot: WeChatBot, msg: IncomingMessage): Promise<MessageSegment[]> {
    const segments: MessageSegment[] = [];
    if (msg.type === "text" && msg.text) {
        segments.push({ type: "text", data: { text: msg.text } });
    }
    for (const img of msg.images) {
        if (!img.media) continue;
        try {
            const buf = await bot.downloadRaw(img.media, img.aeskey);
            const localPath = await saveImageFile(buf);
            logger.info(`WechatBot图片已落地: ${localPath} (${buf.length} 字节)`);
            segments.push({ type: "image", data: { media: { uri: img.url ?? "", localPath } } });
        }
        catch (err) {
            logger.error("WechatBot图片下载落地失败，跳过:", err);
        }
    }
    return segments;
}

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
        const message = await toSegments(bot, msg);
        // 纯语音/文件/视频等暂不支持，转换结果为空直接忽略
        if (message.length === 0) return;
        const space:Space = {
            from: "user",
            id: msg.userId,
            channel: "wechat",
        }
        const ctxEvent:CtxEvent = {
            adapter: adapter,
            // 微信侧暂未暴露消息 id
            messageId: "",
            message,
            space,
            userId: msg.userId,
            nickName: msg.userId,
        }
        await adapter.onMessage(ctxEvent);
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