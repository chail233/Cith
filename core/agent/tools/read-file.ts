import { readFile as fsReadFile } from "node:fs/promises";
import { resolveSrcPath } from "../../utils/file-security.js";
import type { ToolDefinition, ToolModule } from "../types.ts";

/** read_file 工具入参 */
export interface ReadFileParams {
    filepath: string;
}

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "read_file",
        description: "读取指定路径的文件内容",
        parameters: {
            type: "object",
            properties: {
                filepath: {
                    type: "string",
                    description: "相对于 core/ 目录的文件路径",
                },
            },
            required: ["filepath"],
        },
    },
};

/**
 * 读取指定路径的文件内容
 * 安全策略：路径穿越防护（白名单门禁已上移至 callTool）
 */
export async function execute(param: ReadFileParams): Promise<string> {
    const filepath = param?.filepath;
    if (!filepath) return "缺少文件路径参数";

    const pathResult = resolveSrcPath(filepath);
    if (pathResult.error !== undefined) return pathResult.error;

    try {
        return await fsReadFile(pathResult.fullPath, "utf-8");
    }
    catch (err) {
        if (err instanceof Error && "code" in err && err.code === "ENOENT") return `文件 "${filepath}" 不存在`;
        const detail = err instanceof Error ? err.message : String(err);
        return `读取文件失败: ${detail}`;
    }
}

export default { definition, execute } satisfies ToolModule<ReadFileParams>;
