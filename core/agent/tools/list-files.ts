import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveSrcPath } from "../../utils/file-security.js";
import type { ToolDefinition, ToolModule } from "../types.ts";

/** list_files 工具入参 */
export interface ListFilesParams {
    dirpath: string;
}

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "list_files",
        description: "列出指定目录下的文件和子目录",
        parameters: {
            type: "object",
            properties: {
                dirpath: {
                    type: "string",
                    description: "相对于 core/ 的目录路径",
                },
            },
            required: ["dirpath"],
        },
    },
};

/**
 * 列出指定目录下的文件和子目录
 * 安全策略：路径穿越防护（白名单门禁已上移至 callTool）
 */
export async function execute(param: ListFilesParams): Promise<string> {
    const dirpath = param?.dirpath;
    if (!dirpath) return "缺少目录路径参数";

    const pathResult = resolveSrcPath(dirpath);
    if (pathResult.error !== undefined) return pathResult.error;

    try {
        const entries = await readdir(pathResult.fullPath);
        if (entries.length === 0) return `目录 "${dirpath}" 为空`;

        // 获取每个条目的类型信息
        const details = await Promise.all(
            entries.map(async (name) => {
                try {
                    const s = await stat(resolve(pathResult.fullPath, name));
                    return s.isDirectory() ? `${name}/` : name;
                }
                catch {
                    return name;
                }
            })
        );

        return details.join("\n");
    }
    catch (err) {
        if (err instanceof Error && "code" in err) {
            if (err.code === "ENOENT") return `目录 "${dirpath}" 不存在`;
            if (err.code === "ENOTDIR") return `"${dirpath}" 不是目录`;
        }
        const detail = err instanceof Error ? err.message : String(err);
        return `列出目录失败: ${detail}`;
    }
}

export default { definition, execute } satisfies ToolModule<ListFilesParams>;
