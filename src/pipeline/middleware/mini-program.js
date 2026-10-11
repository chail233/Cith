// @ts-check

import recorder from "../../llm/recorder.js";
import logger from "../../utils/logger.js";
import {nowTime} from "../../utils/time.js";

/**
 * 小程序/链接分享处理中间件
 * 检测 JSON 类型的小程序消息，记录上下文后标记已处理
 * @param {object} ctx
 * @returns {Promise<boolean>} 是否已处理（标记 ctx.handled）
 */
export default async function miniProgram(ctx) {
    const segments = ctx.seg || [];

    for (const seg of segments) {
        if (seg.type === "json") {
            try {
                const parsed = JSON.parse(seg.data?.data);
                const title = parsed?.meta?.detail_1?.title;
                if (title) {
                    logger.info("小程序消息:", seg.data.data);
                    const text = `[分享了${title}消息]`;
                    recorder.add({
                        role: "user",
                        content: {
                            name: ctx.senderName,
                            qq: ctx.userId,
                            time: nowTime(),
                            text,
                        },
                    });
                    ctx.handled = true;
                    return true;
                }
            } catch {
                // JSON 解析失败，忽略
            }
        }
    }

    return false;
}