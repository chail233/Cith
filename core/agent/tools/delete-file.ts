import { rm } from "node:fs/promises";
import { resolveSrcPath } from "../../utils/file-security.js";
import type { ToolDefinition, ToolModule } from "../types.ts";

/** delete_file 工具入参 */
export interface DeleteFileParams {
    filepath: string;
}

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "delete_file",
        description: "删除指定路径的文件。此操作不可逆。",
        parameters: {
            type: "object",
            properties: {
                filepath: {
                    type: "string",
                    description: "相对于 core/ 的文件路径",
                },
            },
            required: ["filepath"],
        },
    },
};

/**
 * 删除指定路径的文件
 * 安全策略：路径穿越防护 + 仅限文件（白名单门禁已上移至 callTool）
 */
export async function execute(param: DeleteFileParams): Promise<string> {
    const filepath = param?.filepath;
    if (!filepath) return "缺少文件路径参数";

    const pathResult = resolveSrcPath(filepath);
    if (pathResult.error !== undefined) return pathResult.error;

    try {
        await rm(pathResult.fullPath);
        return `文件 "${filepath}" 删除成功`;
    }
    catch (err) {
        if (err instanceof Error && "code" in err) {
            if (err.code === "ENOENT") return `文件 "${filepath}" 不存在`;
            if (err.code === "EISDIR") return `"${filepath}" 是目录，不允许删除目录`;
        }
        const detail = err instanceof Error ? err.message : String(err);
        return `删除文件失败: ${detail}`;
    }
}

export default { definition, execute } satisfies ToolModule<DeleteFileParams>;
