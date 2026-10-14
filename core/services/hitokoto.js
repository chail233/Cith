// @ts-check

import logger from "../utils/logger.js";
import config from "../config.js";

const API_URL = "https://v1.hitokoto.cn/?min_length=20&max_length=100";

/** 限流状态 */
let count = 0;
let lastTime = Date.now();

/**
 * 获取一言（动漫台词）
 * @returns {Promise<string|null>} 句子文本，超过限流返回 null
 */
export default async function getHitokoto() {
    // 限流检查
    const nowTime = Date.now();
    if (nowTime - lastTime > config.SENTENCE_LIMIT_TIME) {
        lastTime = nowTime;
        count = 0;
    }
    if (count >= config.SENTENCE_LIMIT_COUNT) {
        logger.warn("一言 API 调用超过限流");
        return null;
    }

    try {
        const res = await fetch(API_URL);
        const data = await res.json();
        let str = data.hitokoto;
        if (!str) {
            logger.warn("一言 API 返回格式异常:", data);
            return null;
        }
        // 去掉末尾句号
        if (str.endsWith("。") || str.endsWith(".")) {
            str = str.slice(0, -1);
        }
        count++;
        return str;
    } catch (err) {
        logger.error("获取一言失败:", err);
        return null;
    }
}