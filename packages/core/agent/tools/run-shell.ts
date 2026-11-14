import { spawn } from "node:child_process";
import { resolveSrcPath } from "../../utils/file-security.js";
import type { ToolDefinition, ToolModule } from "../types.ts";

/** run_shell 工具入参 */
export interface RunShellParams {
    command?: unknown;
    cwd?: unknown;
}

const IS_WIN = process.platform === "win32";
const OUTPUT_KEEP = 4 * 1024; // 展示给模型时头尾各保留的字符数
const OUTPUT_CAP = 1_000_000; // 采集阶段的内存保护上限（字符数）

const SHELL_HINT = IS_WIN
    ? "当前系统 Windows，命令为 PowerShell 语法（Get-ChildItem、Select-String 等），支持管道"
    : "当前系统 Linux，命令为 bash 语法";

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "run_shell",
        description: `执行 shell 命令并返回输出与退出码。${SHELL_HINT}。命令会经安全审查（open 模式下管理员豁免），可疑命令需管理员确认`,
        parameters: {
            type: "object",
            properties: {
                command: { type: "string", description: "要执行的命令" },
                cwd: { type: "string", description: "工作目录，相对 dist/，默认 workspace" },
            },
            required: ["command"],
        },
    },
};

function truncate(text: string): string {
    if (text.length <= OUTPUT_KEEP * 2) return text;
    return `${text.slice(0, OUTPUT_KEEP)}\n[...输出过长，中间已截断...]\n${text.slice(-OUTPUT_KEEP)}`;
}

/**
 * 还原 PowerShell 重定向到 stderr 的 CLIXML 序列化文本：
 * 提取 <S> 元素内容并解码 _xHHHH_ 转义；非 CLIXML 输出原样返回
 */
function cleanPsStderr(text: string): string {
    if (!text.includes("<Objs")) {
        return text.replace(/^#< CLIXML\r?\n?/m, "");
    }
    const parts = [...text.matchAll(/<S [^>]*>([\s\S]*?)<\/S>/g)].map((m) => m[1]);
    return (parts.length ? parts.join("\n") : text)
        .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * 执行 shell 命令
 */
export async function execute(param: RunShellParams): Promise<string> {
    const command = typeof param?.command === "string" ? param.command.trim() : "";
    if (!command) return "缺少命令";

    const cwdInput = typeof param?.cwd === "string" && param.cwd.trim() ? param.cwd : "workspace";
    const resolved = resolveSrcPath(cwdInput);
    if (resolved.error !== undefined) return resolved.error;

    return await new Promise((resolve) => {
        const child = IS_WIN
            ? spawn(
                "powershell.exe",
                ["-NoProfile", "-EncodedCommand", Buffer.from(`$ProgressPreference='SilentlyContinue'; ${command}`, "utf16le").toString("base64")],
                { cwd: resolved.fullPath },
            )
            : spawn("bash", ["-c", command], { cwd: resolved.fullPath });

        const outBuf = { v: "" };
        const errBuf = { v: "" };
        let dropped = false;
        const collect = (buf: { v: string }) => (chunk: Buffer | string) => {
            if (buf.v.length > OUTPUT_CAP) {
                dropped = true;
                return;
            }
            buf.v += chunk;
        };
        child.stdout.on("data", collect(outBuf));
        child.stderr.on("data", collect(errBuf));
        child.stdin?.end(); // 立即关闭 stdin，避免 read 类命令等待输入挂死

        child.on("error", (spawnErr) => {
            resolve(`启动 shell 失败: ${spawnErr.message}`);
        });
        child.on("close", (code) => {
            if (dropped) outBuf.v += "\n[...输出过大，后续已丢弃...]";
            const errText = IS_WIN ? cleanPsStderr(errBuf.v) : errBuf.v;
            const output = [outBuf.v.trimEnd(), errText.trim()].filter(Boolean).join("\n");
            resolve(`退出码 ${code ?? "—"}\n${truncate(output) || "（无输出）"}`);
        });
    });
}

export default { definition, execute } satisfies ToolModule<RunShellParams>;
