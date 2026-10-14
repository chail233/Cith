// @ts-check

import config from "../../config.js";

/**
 * @bot 检测中间件
 * 检查消息中是否 @了机器人
 * @param {object} ctx
 */
export default function atDetector(ctx) {
    const segments = ctx.seg || [];
    for (const seg of segments) {
        if (seg.type === "at" && seg.data?.qq === config.selfId) {
            ctx.isAtBot = true;
            break;
        }
    }
}