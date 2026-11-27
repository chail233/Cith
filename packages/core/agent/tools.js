import config from "../config.js";
import logger from "../utils/logger.js";
import { hold } from "./tool-approval.ts";
import { onToolStart, onToolEnd } from "./tool-hooks.ts";
import { checkShellCommand } from "./shell-guard.ts";

import getMemoryTool from "./tools/get-memory.ts";
import finishTurnTool from "./tools/finish-turn.ts";
import listStickersTool from "./tools/list-stickers.ts";
import managePlanTool from "./tools/manage-plan.ts";
import scheduleTool from "./tools/schedule.ts";
import recognizeImageTool from "./tools/recognize-image.ts";
import runShellTool from "./tools/run-shell.ts";
import searchToolsTool from "./tools/search-tools.ts";
import useToolTool from "./tools/use-tool.ts";

/**
 * 工具注册表：每个条目包含 definition（工具上下文/参数定义）和 execute（实现）
 * 工具表应尽可能保持稳定，避免频繁变化
 */
const toolRegistry = [
    getMemoryTool,
    listStickersTool,
    managePlanTool,
    scheduleTool,
    recognizeImageTool,
    runShellTool,
    searchToolsTool,
    useToolTool,
    finishTurnTool,
];

/**
 * 模型可以调用的工具定义列表
 * @type {import("./types.ts").ToolDefinition[]}
 */
const tools = toolRegistry.map((t) => t.definition);

const toolMap = new Map(
    toolRegistry.map((t) => [t.definition.function.name, t.execute]),
);

const TIMEOUT_GRACE_MS = 10_000;

/**
 * 给一次工具执行加超时与中断：超时/用户中断时立即放弃等待并回填说明文本
 * 执行自身抛错时原样透传，不改变调用方的错误语义
 * @param {string} name 工具名
 * @param {() => Promise<string>} execute 工具执行
 * @param {number} budgetMs 超时（毫秒），非正数表示不限
 * @param {AbortSignal} [signal] 本轮中断信号
 * @returns {Promise<{status: "returned" | "aborted" | "timeout", output: string}>}
 */
function withToolTimeout(name, execute, budgetMs, signal) {
    const limited = Number.isFinite(budgetMs) && budgetMs > 0;
    return new Promise((resolve, reject) => {
        let timer = null;
        const cleanup = () => {
            if (timer) clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
        };
        const onAbort = () => {
            cleanup();
            resolve({ status: "aborted", output: `${name} 已被中断，已停止等待` });
        };
        if (signal?.aborted) return onAbort();
        if (limited) {
            timer = setTimeout(() => {
                cleanup();
                resolve({
                    status: "timeout",
                    output: `${name} 执行超时（${Math.round(budgetMs / 1000)} 秒），已放弃等待；命令可能仍在后台运行，需要结果时请稍后用其它工具确认`,
                });
            }, budgetMs);
            timer.unref?.();
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        Promise.resolve().then(() => {
            signal?.throwIfAborted();
            return execute();
        }).then(
            (output) => {
                cleanup();
                resolve({ status: "returned", output });
            },
            (err) => {
                cleanup();
                reject(err);
            },
        );
    });
}

/**
 * 模型可调用的工具定义
 * @returns {import("./types.ts").ToolDefinition[]}
 */
export function getAllTools() {
    return tools;
}

/**
 * 调用工具
 * @param {import("./types.ts").ToolCall} tool_call 完整的工具调用对象 { id, function: { name, arguments } }
 * @param {import("./types.ts").ToolContext} [ctx] 工具执行上下文
 * @param {boolean} [confirmed=false] 是否已确认
 * @returns {Promise<import("./types.ts").ToolCallResult>} 正常为文本结果；门禁挂起时返回 ToolHold（不回给模型）
 */
export async function callTool(tool_call, ctx, confirmed = false){
    const name = tool_call.function.name;
    const parameter = JSON.parse(tool_call.function.arguments);
    const signal = ctx?.signal;

    // run_shell 门禁：已确认重执行直通；非管理员任何模式都审查，
    // 管理员仅 guard 模式审查、open 模式直通。allow 放行，deny/unsure/未配置 guardModel/调用失败一律挂起
    if (!confirmed && name === "run_shell" && !(config.shellGate === "open" && ctx?.isAdmin)) {
        const verdict = await checkShellCommand(String(parameter?.command ?? ""));
        if (!verdict || verdict.verdict !== "allow") {
            const id = hold(tool_call, ctx);
            if (!id) return `${name} 被拒绝：待确认队列已满，请稍后再试`;
            const why = verdict
                ? `guard 判定 ${verdict.verdict}：${verdict.reason || "无"}`
                : "未配置 guard 模型";
            // 挂起信息不回给模型：Agent 主循环就此中断，由分发方经适配器发出确认询问
            return {
                held: true,
                id,
                toolName: name,
                reason: why,
                summary: String(parameter?.command ?? "").slice(0, 200),
                requestedBy: ctx?.userId ?? "",
                requestedByName: ctx?.senderName ?? "未知用户",
            };
        }
        logger.info(`guard 放行 run_shell: ${verdict.reason}`);
    }

    const tool = toolMap.get(name);
    if (!tool) {
        throw new Error(`未知工具: ${name}`);
    }
    // run_shell 自己到点强杀子进程，外层多留余量再放弃等待
    const budget = name === "run_shell" ? config.toolTimeout + TIMEOUT_GRACE_MS : config.toolTimeout;
    let start;
    /** @type {Parameters<typeof onToolEnd>[2]} */
    let status = "error";
    try {
        const result = await withToolTimeout(name, () => {
            start = onToolStart(ctx, tool_call);
            return tool(parameter, ctx);
        }, budget, signal);
        status = result.status;
        return `${name}调用结果:\n${result.output}`;
    } finally {
        if (start) onToolEnd(ctx, start, status);
    }
}
