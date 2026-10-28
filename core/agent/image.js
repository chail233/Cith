// @ts-check

import { callLLM } from "./client.ts";
import config from "../config.js";
import logger from "../utils/logger.js";

/**
 * 图片类型 → MIME 映射
 */
const MIME_MAP = {
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
};

/**
 * 识别图片内容
 * @param {string} base64 图片 Base64 编码
 * @param {"jpg"|"png"|"webp"} type 图片类型
 * @returns {Promise<string|null>} 图片描述文本，失败返回 null
 */
export default async function recognizeImage(base64, type) {
    const mime = MIME_MAP[type];
    if (!mime) {
        logger.warn("不支持的图片类型:", type);
        return null;
    }

    const result = await callLLM({
        model: config.VISION_MODEL,
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "image_url",
                        image_url: { url: `data:${mime};base64,${base64}` },
                    },
                    {
                        type: "text",
                        text: "请准确描述这张图片的内容，回答长度适中，只输出描述，不要带有其它格式的内容。",
                    },
                ],
            },
        ],
        mode:"vision"
    });

    if (typeof result === "string") {
        return null;
    }

    if (!result?.message?.content) {
        logger.error("识图 API 无响应");
        return null;
    }

    logger.info(`本次识图消耗: ${result.totalTokens} tokens`);
    return result.message.content;
}