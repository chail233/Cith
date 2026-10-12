// @ts-check

import { getImage } from "../../services/napcat.js";
import getImageType from "../../utils/image-type.js";
import recognizeImage from "../../llm/image.js";
import logger from "../../utils/logger.js";
import fs from "fs/promises";


const enable = true;
/**
 * 图片识别中间件
 * 检测消息中的图片，自动识别内容并写入 context.imageDescription
 * @param {object} ctx
 */
export default async function imageRecognizer(ctx) {
    if(!enable) return;
    const segments = ctx.seg || [];
    let description = "";

    for (const seg of segments) {
        if (seg.type === "image") {
            try {
                const fileData = await getImage(seg.data.file);
                if (!fileData?.data?.file) continue;

                const type = getImageType(fileData.data.file);
                if (!type) continue;

                const buf = await fs.readFile(fileData.data.file);
                const base64 = buf.toString("base64");
                const reply = await recognizeImage(base64, type);

                if (reply) {
                    logger.info("图片识别结果:", reply);
                    description += `\n[发送了图片，内容描述：${reply}]`;
                }
            }
            catch (err) {
                logger.error("图片识别失败:", err);
            }
        }
    }

    if (description) {
        ctx.imageDescription = description.trim();
    }
}