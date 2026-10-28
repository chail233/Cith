import { readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import { resolveSrcPath } from "../../utils/file-security.js";
import type { ToolDefinition, ToolModule } from "../types.ts";

/** 单个搜索替换编辑操作 */
export interface EditOperation {
    oldText: string;
    newText: string;
}

/** edit_file 工具入参 */
export interface EditFileParams {
    filepath: string;
    edits: EditOperation[];
}

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "edit_file",
        description: "通过搜索替换的方式编辑文件内容。每个编辑操作需提供要查找的原文和替换后的新文本，原文必须在文件中唯一匹配。多个 edit 之间是有顺序依赖的。",
        parameters: {
            type: "object",
            properties: {
                filepath: {
                    type: "string",
                    description: "相对于 core/ 的文件路径",
                },
                edits: {
                    type: "array",
                    description: "编辑操作列表，每个操作包含 oldText（要查找的原文）和 newText（替换后的内容）",
                    items: {
                        type: "object",
                        properties: {
                            oldText: {
                                type: "string",
                                description: "要被替换的原始文本片段，必须在文件中唯一匹配，请包含足够上下文以确保唯一性",
                            },
                            newText: {
                                type: "string",
                                description: "替换后的新文本",
                            },
                        },
                        required: ["oldText", "newText"],
                    },
                },
            },
            required: ["filepath", "edits"],
        },
    },
};

/**
 * 通过搜索替换编辑文件内容
 * 安全策略：路径穿越防护 + 唯一匹配校验（白名单门禁已上移至 callTool）
 */
export async function execute(param: EditFileParams): Promise<string> {
    const filepath = param?.filepath;
    const edits = param?.edits;
    if (!filepath) return "缺少文件路径参数";
    if (!Array.isArray(edits) || edits.length === 0) return "缺少编辑操作（edits 必须为非空数组）";

    const pathResult = resolveSrcPath(filepath);
    if (pathResult.error !== undefined) return pathResult.error;

    // 读取原文
    let content: string;
    try {
        content = await fsReadFile(pathResult.fullPath, "utf-8");
    }
    catch (err) {
        if (err instanceof Error && "code" in err && err.code === "ENOENT") return `文件 "${filepath}" 不存在`;
        const detail = err instanceof Error ? err.message : String(err);
        return `读取文件失败: ${detail}`;
    }

    // 逐个应用编辑
    for (let i = 0; i < edits.length; i++) {
        const { oldText, newText } = edits[i];
        if (!oldText) return `第 ${i + 1} 个编辑失败：oldText 不能为空`;

        // 查找匹配位置（找到 2 个即停止，足以判断唯一性）
        const indices = [];
        let pos = 0;
        while ((pos = content.indexOf(oldText, pos)) !== -1) {
            indices.push(pos);
            if (indices.length >= 2) break;
            pos += 1;
        }

        if (indices.length === 0) {
            return `第 ${i + 1} 个编辑失败：在文件中找不到指定的文本`;
        }

        if (indices.length > 1) {
            // 计算匹配到的行号，帮助 AI 定位
            const lineNums = indices.map(idx => {
                return content.slice(0, idx).split("\n").length;
            });
            return `第 ${i + 1} 个编辑失败：匹配到多处（如第 ${lineNums.join(", ")} 行等），请在 oldText 中包含更多上下文以精确定位`;
        }

        // 唯一匹配，执行替换
        content = content.slice(0, indices[0]) + newText + content.slice(indices[0] + oldText.length);
    }

    // 写回文件
    try {
        await fsWriteFile(pathResult.fullPath, content, "utf-8");
        return "文件编辑成功";
    }
    catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return `写入文件失败: ${detail}`;
    }
}

export default { definition, execute } satisfies ToolModule<EditFileParams>;
