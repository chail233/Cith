import { extname } from "node:path";
import { execFile } from "node:child_process";
import { resolveSrcPath } from "../../utils/file-security.js";
import type { ToolDefinition, ToolModule } from "../types.ts";

/** run_JS 工具入参 */
export interface RunJsParams {
    filepath: string;
    args?: Record<string, unknown>;
}

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "run_JS",
        description: "运行 JavaScript 脚本，可通过 args 传递参数给脚本。",
        parameters: {
            type: "object",
            properties: {
                filepath: {
                    type: "string",
                    description: "相对于 core/ 的JavaScript 脚本文件路径",
                },
                args: {
                    type: "object",
                    description: "传递给脚本的参数，脚本通过 process.argv[2] 接收（JSON 字符串）",
                },
            },
            required: ["filepath"],
        },
    },
};

/**
 * 运行指定路径的 JS 脚本并返回执行结果
 * 安全策略：路径穿越防护 + 仅限 .js 文件（白名单门禁已上移至 callTool）
 */
export async function execute(param: RunJsParams): Promise<string> {
    const filepath = param?.filepath;
    if (!filepath) return "缺少文件路径参数";

    // 仅允许 .js 文件
    if (extname(filepath) !== ".js") {
        return "只能执行 .js 文件";
    }

    const pathResult = resolveSrcPath(filepath);
    if (pathResult.error !== undefined) return pathResult.error;

    try {
        // 在子进程中执行脚本，参数通过 process.argv[2] 以 JSON 形式传递
        const args = param?.args ?? {};
        const argsJson = JSON.stringify(args);

        // --use-system-ca 仅在 Windows 上需要，用于使用系统证书存储解决 SSL 问题
        const nodeArgs = process.platform === "win32"
            ? ["--use-system-ca", pathResult.fullPath, argsJson]
            : [pathResult.fullPath, argsJson];

        const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
            execFile(process.execPath, nodeArgs, { timeout: 30000 }, (error, stdout, stderr) => {
                if (error) {
                    if (stderr) reject(new Error(stderr.trim()));
                    else reject(error);
                }
                else {
                    resolve({ stdout, stderr });
                }
            });
        });
        const output = stdout.trim();
        if (output) return output;
        if (stderr.trim()) return `脚本执行完成，但有警告输出:\n${stderr.trim()}`;
        return "脚本执行成功（无输出）";
    }
    catch (err) {
        if (err instanceof Error && "code" in err && err.code === "ENOENT") {
            return `脚本文件 "${filepath}" 不存在`;
        }
        if (typeof err === "object" && err !== null && "killed" in err && err.killed === true) {
            return "脚本执行超时（30秒限制）";
        }
        const detail = err instanceof Error ? err.message : String(err);
        return `脚本执行失败: ${detail}`;
    }
}

export default { definition, execute } satisfies ToolModule<RunJsParams>;
