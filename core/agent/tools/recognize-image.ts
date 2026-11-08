import { readFile as fsReadFile } from "node:fs/promises";
import getImageType from "../../utils/image-type.js";
import recognizeImage from "../image.js";
import type { ToolDefinition, ToolModule } from "../types.ts";

/** recognize_image 工具入参 */
export interface RecognizeImageParams {
    path: string;
}

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "recognize_image",
        description: "识别图片内容，返回图片的内容描述。图片不会自动识别，需要查看时传入消息中图片段的 media.localPath",
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "图片文件的本地路径，取自消息中图片段的 media.localPath",
                },
            },
            required: ["path"],
        },
    },
};

/**
 * 识别图片内容
 * 安全策略：魔数校验兜底——只允许真正的 jpg/png/webp 图片进入视觉模型（gif 不支持）
 */
export async function execute(param: RecognizeImageParams): Promise<string> {
    const path = param?.path;
    if (!path) return "缺少图片路径参数";

    let type: "jpg" | "png" | "gif" | "webp" | null;
    try {
        type = getImageType(path);
    }
    catch {
        return `图片 "${path}" 不存在或无法读取`;
    }
    if (!type || type === "gif") return "不是受支持的图片文件（仅支持 jpg/png/webp）";

    try {
        const buf = await fsReadFile(path);
        const description = await recognizeImage(buf.toString("base64"), type);
        if (!description) return "图片识别失败";
        return description;
    }
    catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return `图片识别失败: ${detail}`;
    }
}

export default { definition, execute } satisfies ToolModule<RecognizeImageParams>;
