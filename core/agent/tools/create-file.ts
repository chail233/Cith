import { writeFile as fsWriteFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveSrcPath } from "../../utils/file-security.js";
import type { ToolDefinition, ToolModule } from "../types.ts";

/** create_file 工具入参 */
export interface CreateFileParams {
    filepath: string;
    content: string;
}

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "create_file",
        description: "在指定路径创建新文件。文件必须不存在，否则会被拒绝。",
        parameters: {
            type: "object",
            properties: {
                filepath: {
                    type: "string",
                    description: "相对于 core/ 的文件路径",
                },
                content: {
                    type: "string",
                    description: "文件内容",
                },
            },
            required: ["filepath", "content"],
        },
    },
};

/**
 * 在指定路径创建新文件
 * 安全策略：路径穿越防护 + 禁止覆盖已有文件（白名单门禁已上移至 callTool）
 */
export async function execute(param: CreateFileParams): Promise<string> {
    const filepath = param?.filepath;
    const content = param?.content;
    if (!filepath) return "缺少文件路径参数";
    if (content === undefined || content === null) return "缺少文件内容参数";

    const pathResult = resolveSrcPath(filepath);
    if (pathResult.error !== undefined) return pathResult.error;

    try {
        // 确保父目录存在
        await mkdir(dirname(pathResult.fullPath), { recursive: true });

        // 使用 wx 标志：文件已存在时写入失败，防止意外覆盖
        await fsWriteFile(pathResult.fullPath, content, { encoding: "utf-8", flag: "wx" });
        return `文件 "${filepath}" 创建成功`;
    }
    catch (err) {
        if (err instanceof Error && "code" in err && err.code === "EEXIST") {
            return `文件 "${filepath}" 已存在，无法覆盖。如需修改请使用 edit_file`;
        }
        const detail = err instanceof Error ? err.message : String(err);
        return `创建文件失败: ${detail}`;
    }
}

export default { definition, execute } satisfies ToolModule<CreateFileParams>;
