// @ts-check

import logger from "../utils/logger.js";
import { buildContext } from "./context.ts";
import imageRecognizer from "./middleware/image-recognizer.js";
import atDetector from "./middleware/at-detector.js";
import miniProgram from "./middleware/mini-program.js";
import keywordCommands from "./handlers/keyword-commands.js";
import userCommands, { isBootstrapCommand } from "./handlers/user-commands.js";
import aiChat from "./handlers/ai-chat.js";
import repeater from "./handlers/repeater.js";
import proactiveChat from "./handlers/proactive-chat.js";

/** 中间件列表 */
const middlewares = [
    imageRecognizer,
    atDetector,
    miniProgram,
];

/** 处理器列表 */
const handlers = [
    keywordCommands,
    userCommands,
    aiChat,
    repeater,
    proactiveChat,
];

/** 未授权会话的忽略提示节流：同一会话 10 分钟内最多记一次 */
const IGNORE_NOTIFY_INTERVAL_MS = 10 * 60 * 1000;
/** @type {Map<string, number>} */
const ignoredSessions = new Map();

/**
 * 记录被忽略的未授权会话，便于排查「机器人为什么不理我」
 * @param {import("../types/index.ts").Context} ctx
 */
function logIgnoredSession(ctx) {
    const key = `${ctx.space.from}:${ctx.space.id}`;
    const now = Date.now();
    const last = ignoredSessions.get(key) ?? 0;
    if (now - last < IGNORE_NOTIFY_INTERVAL_MS) return;

    // 表本身无上限：达到规模后清理已过期的键，防止长期运行累积
    if (ignoredSessions.size >= 500) {
        for (const [k, ts] of ignoredSessions) {
            if (now - ts >= IGNORE_NOTIFY_INTERVAL_MS) ignoredSessions.delete(k);
        }
    }
    ignoredSessions.set(key, now);

    const label = ctx.space.from === "group" ? "群" : "用户";
    logger.debug(`已忽略未授权${label} ${ctx.space.id} 的消息（管理员可发送 #bind 加入白名单）`);
}

/**
 * 事件管道：接收事件，按中间件→处理器流水线处理
 *
 * @param {import("../types/index.ts").CtxEvent} ctxEvent 事件
 */
export default async function runPipeline(ctxEvent) {
    //构建上下文
    const ctx = buildContext(ctxEvent);
    // 过滤：仅处理目标会话；未授权会话仅放行管理员的绑定引导指令
    if (!ctx.isTarget) {
        if (!(ctx.isAdmin && isBootstrapCommand(ctx.text))) {
            logIgnoredSession(ctx);
            return;
        }
        logger.info(`管理员在未授权会话 ${ctx.space.from}:${ctx.space.id} 执行绑定指令`);
    }

    logger.debug(`处理消息: ${ctx.senderName}: ${ctx.text}`);

    // 运行中间件（全部执行，不阻塞管道）
    for (const mw of middlewares) {
        try {
            await mw(ctx);
        }
        catch (err) {
            logger.error("中间件执行出错:", mw.name, err);
        }
    }

    //如果中间件已标记为处理完毕
    if (ctx.handled) return;

    //运行处理器，第一个返回 true 的停止后续处理器
    if(ctx.text.trim()==="" && !ctx.imageDescription) return;
    for (const handler of handlers) {
        try {
            const handled = await handler(ctx);
            if (handled === true) {
                logger.debug(`处理器已处理: ${handler.name}`);
                break;
            }
        }
        catch (err) {
            logger.error("处理器执行出错:", handler.name, err);
        }
    }
}