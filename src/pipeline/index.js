// @ts-check

import logger from "../utils/logger.js";
import { buildContext } from "./context.ts";
import imageRecognizer from "./middleware/image-recognizer.js";
import atDetector from "./middleware/at-detector.js";
import miniProgram from "./middleware/mini-program.js";
import keywordCommands from "./handlers/keyword-commands.js";
import userCommands from "./handlers/user-commands.js";
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

/**
 * 事件管道：接收 OneBot 事件，按中间件→处理器流水线处理
 *
 * @param {object} ctxEvent OneBot 事件
 */
export default async function runPipeline(ctxEvent) {
    //构建上下文
    const ctx = buildContext(ctxEvent);
    //过滤：仅处理目标消息
    if (!ctx.isTarget) return;

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

    // 5. 如果中间件已标记为处理完毕（如小程序分享），则跳过处理器
    if (ctx.handled) return;

    // 6. 运行处理器，第一个返回 true 的停止后续处理器
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