// @ts-check

import logger from "../utils/logger.js";

const API_URL = "https://api.yppp.net/pc.php?return=json";

/**
 * 获取随机 ACG 图片
 * @returns {Promise<Array<{type: "image", data: {file: string}}>|null>}
 */
export default async function getAcgImage() {
    try {
        const res = await fetch(API_URL);
        const data = await res.json();
        if (!data.acgurl) {
            logger.warn("ACG API 返回格式异常:", data);
            return null;
        }
        return [{ type: "image", data: { file: data.acgurl } }];
    } catch (err) {
        logger.error("获取 ACG 图片失败:", err);
        return null;
    }
}