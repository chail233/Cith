import getImageType from "../../utils/image-type.js";
import recognizeImage from "../../agent/image.js";
import logger from "../../utils/logger.js";
import fs from "fs/promises";


const enable = true;

export default async function imageRecognizer(ctx) {
    if(!enable) return;
    const segments = /** @type {Array<{type: string, data: {media?: {localPath?: string}}}>} */ (ctx.message || []);
    let description = "";

    for (const seg of segments) {
        if (seg.type === "image") {
            try {
                const localPath = seg.data.media?.localPath;
                if (!localPath) {
                    logger.warn("图片段没有本地路径，跳过识别（服务器层未解析出图片）");
                    continue;
                }

                const type = getImageType(localPath);
                if (!type || type === "gif") continue;

                const buf = await fs.readFile(localPath);
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
