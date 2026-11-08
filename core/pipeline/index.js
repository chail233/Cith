import logger from "../utils/logger.js";
import { extractText } from "../utils/extractText.ts";
import { buildContext } from "./context.ts";
import keywordCommands from "./handlers/keyword-commands.js";
import userCommands, { isBootstrapCommand } from "./handlers/user-commands.js";
import aiChat from "./handlers/ai-chat.js";
import proactiveChat from "./handlers/proactive-chat.js";

/** 处理器列表 */
const handlers = [
    keywordCommands,
    userCommands,
    aiChat,
    proactiveChat,
];


export default async function runPipeline(ctxEvent) {
    //构建上下文
    const ctx = buildContext(ctxEvent);
    const text = extractText(ctx.message);
    if (!ctx.isTarget) {
        if (!(ctx.isAdmin && isBootstrapCommand(text))) {
            return;
        }
    }

    logger.debug(`处理消息: ${ctx.senderName}: ${text}`);

    //如果已标记为处理完毕
    if (ctx.handled) return;

    //运行处理器，第一个返回 true 的停止后续处理器
    //无文本的纯图片消息也放行：图片是否值得识别由模型按需调用 recognize_image 决定
    if (text.trim() === "" && !ctx.message.some((seg) => seg.type === "image")) return;
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
