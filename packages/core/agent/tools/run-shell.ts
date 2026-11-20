import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolveSrcPath } from "../../utils/file-security.js";
import config from "../../config.js";
import type { ToolContext, ToolDefinition, ToolModule } from "../types.ts";

/** run_shell 工具入参 */
export interface RunShellParams {
    command?: unknown;
    cwd?: unknown;
}

const IS_WIN = process.platform === "win32";
const OUTPUT_KEEP = 4 * 1024; // 展示给模型时头尾各保留的字符数
const OUTPUT_CAP = 1_000_000; // 采集阶段的内存保护上限（字符数）
/** 超时强杀后的宽限期：杀不掉就放弃等待，避免工具链被永久挂住 */
const KILL_GRACE_MS = 5_000;

const SHELL_HINT = IS_WIN
    ? "当前系统 Windows，命令为 PowerShell 语法（Get-ChildItem、Select-String 等），支持管道"
    : "当前系统 Linux，命令为 bash 语法（bash 缺失时自动降级 sh，bash 特有语法可能不被支持）";

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "run_shell",
        description: `执行 shell 命令并返回输出与退出码。${SHELL_HINT}。${config.toolTimeout > 0 ? `超过 ${Math.round(config.toolTimeout / 1000)} 秒的命令会被强制终止；` : ""}命令会经安全审查（open 模式下管理员豁免），可疑命令需管理员确认`,
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

/** 终止子进程树：Windows 用 taskkill /T，POSIX 直接 SIGKILL */
function killTree(child: ChildProcessWithoutNullStreams): void {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (IS_WIN && child.pid) {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        return;
    }
    child.kill("SIGKILL");
}

/**
 * 等待子进程退出并采集输出；进程没能拉起（如 bash 不存在）时以 spawnError 返回
 * 超时或收到中断信号时强制终止进程树，宽限期内仍未退出则不再等待
 */
function capture(child: ChildProcessWithoutNullStreams, timeoutMs: number, signal?: AbortSignal): Promise<{ text: string; spawnError?: NodeJS.ErrnoException }> {
    return new Promise((resolve) => {
        const outBuf = { v: "" };
        const errBuf = { v: "" };
        let dropped = false;
        let timedOut = false;
        let interrupted = false;
        let settled = false;
        let timer: NodeJS.Timeout | null = null;
        let graceTimer: NodeJS.Timeout | null = null;
        let onAbort: () => void = () => {};

        const finish = (result: { text: string; spawnError?: NodeJS.ErrnoException }) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            if (graceTimer) clearTimeout(graceTimer);
            signal?.removeEventListener("abort", onAbort);
            resolve(result);
        };
        const build = (code: number | null) => {
            if (dropped) outBuf.v += "\n[...输出过大，后续已丢弃...]";
            const errText = IS_WIN ? cleanPsStderr(errBuf.v) : errBuf.v;
            const output = [outBuf.v.trimEnd(), errText.trim()].filter(Boolean).join("\n");
            const head = interrupted
                ? `退出码 ${code ?? "—"}（已中断，命令已强制终止）`
                : timedOut
                    ? `退出码 ${code ?? "—"}（超过 ${Math.round(timeoutMs / 1000)} 秒超时，已强制终止）`
                    : `退出码 ${code ?? "—"}`;
            return `${head}\n${truncate(output) || "（无输出）"}`;
        };
        /** 超时或中断：强杀进程树（PowerShell 下子进程不会被外层 kill 带走），宽限后不再等待 */
        const stop = (reason: "timeout" | "abort") => {
            if (reason === "abort") interrupted = true;
            else timedOut = true;
            killTree(child);
            graceTimer = setTimeout(() => finish({ text: build(child.exitCode) }), KILL_GRACE_MS);
            graceTimer.unref?.();
        };
        onAbort = () => stop("abort");
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

        if (signal?.aborted) {
            onAbort();
        }
        else {
            if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
                timer = setTimeout(() => stop("timeout"), timeoutMs);
                timer.unref?.();
            }
            signal?.addEventListener("abort", onAbort, { once: true });
        }

        child.on("error", (spawnErr) => finish({ text: "", spawnError: spawnErr }));
        child.on("close", (code) => finish({ text: build(code) }));
    });
}

/**
 * 执行 shell 命令；Linux 下 bash 不在 PATH 时降级用 sh 再试一次
 */
export async function execute(param: RunShellParams, ctx?: ToolContext): Promise<string> {
    const command = typeof param?.command === "string" ? param.command.trim() : "";
    if (!command) return "缺少命令";

    const signal = ctx?.signal;
    const cwdInput = typeof param?.cwd === "string" && param.cwd.trim() ? param.cwd : "workspace";
    const resolved = resolveSrcPath(cwdInput);
    if (resolved.error !== undefined) return resolved.error;

    // cwd 缺失时 spawn 报的 ENOENT 会误指 shell 本体，先确保目录在
    try {
        mkdirSync(resolved.fullPath, { recursive: true });
    }
    catch {
        return `工作目录不可用: ${resolved.fullPath}`;
    }

    const child = IS_WIN
        ? spawn(
            "powershell.exe",
            ["-NoProfile", "-EncodedCommand", Buffer.from(`$ProgressPreference='SilentlyContinue'; ${command}`, "utf16le").toString("base64")],
            { cwd: resolved.fullPath },
        )
        : spawn("bash", ["-c", command], { cwd: resolved.fullPath });

    const timeoutMs = config.toolTimeout;
    const result = await capture(child, timeoutMs, signal);
    if (!result.spawnError) return result.text;
    if (IS_WIN || result.spawnError.code !== "ENOENT") return `启动 shell 失败: ${result.spawnError.message}`;

    const fallback = await capture(spawn("sh", ["-c", command], { cwd: resolved.fullPath }), timeoutMs, signal);
    if (fallback.spawnError) return `启动 shell 失败: ${fallback.spawnError.message}`;
    return `（bash 不可用，本次经 sh 执行）\n${fallback.text}`;
}

export default { definition, execute } satisfies ToolModule<RunShellParams>;
