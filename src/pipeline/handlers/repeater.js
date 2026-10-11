// @ts-check

import needRepeat from "../../tools/repeater.js";
import recorder from "../../llm/recorder.js";
import { nowTime } from "../../utils/time.js";

/**
 * 复读处理器
 * 检测到复读模式时自动复读
 */

/**
 * @param {object} ctx
 * @returns {Promise<boolean>}
 */
export default async function repeater(ctx) {
    if (!ctx.text) return false;
    // 避免与命令冲突
    if (ctx.text.startsWith("#") || ctx.text.startsWith("/")) return false;

    if (needRepeat(ctx.text)) {
        ctx.adapter.sendGroupMsg(ctx.space.id, ctx.text);
        recorder.add({ role: "assistant", content: { text: ctx.text, time: nowTime() } });
        return true;
    }

    return false;
}