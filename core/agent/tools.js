import config from "../config.js";
import logger from "../utils/logger.js";
import { mcpClient } from "./mcp-manager.js";
import { hold } from "./tool-approval.js";
import { checkShellCommand } from "./shell-guard.ts";

import getMemoryTool from "./tools/get-memory.ts";
import manageMcpTool from "./tools/manage-mcp.ts";
import listStickersTool from "./tools/list-stickers.ts";
import managePlanTool from "./tools/manage-plan.ts";
import scheduleTool from "./tools/schedule.ts";
import reportProgressTool from "./tools/report-progress.ts";
import recognizeImageTool from "./tools/recognize-image.ts";
import runShellTool from "./tools/run-shell.ts";

/**
 * 工具注册表：每个条目包含 definition（工具上下文/参数定义）和 execute（实现）
 */
const toolRegistry = [
    getMemoryTool,
    manageMcpTool,
    listStickersTool,
    managePlanTool,
    scheduleTool,
    reportProgressTool,
    recognizeImageTool,
    runShellTool,
];

/**
 * 模型可以调用的工具定义列表
 * @type {import("./types.ts").ToolDefinition[]}
 */
const tools = toolRegistry.map((t) => t.definition);

const toolMap = new Map(
    toolRegistry.map((t) => [t.definition.function.name, t.execute]),
);

/**
 * 模型可调用的工具定义：本地工具 + 已激活 MCP 服务器的工具
 * @returns {import("./types.ts").ToolDefinition[]}
 */
export function getAllTools() {
    return [...tools, ...mcpClient.getActiveToolDefinitions()];
}

/**
 * 调用工具
 * @param {import("./types.ts").ToolCall} tool_call 完整的工具调用对象 { id, function: { name, arguments } }
 * @param {import("../types/index.ts").Context & {agent?: import("./Agent.ts").default}} [ctx] 请求上下文
 * @param {boolean} [confirmed=false] 是否已确认
 */
export async function callTool(tool_call, ctx, confirmed = false){
    const name = tool_call.function.name;
    const parameter = JSON.parse(tool_call.function.arguments);

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
            return `run_shell 命令需要管理员确认（${why}）。已登记为待确认操作 #${id}。`;
        }
        logger.info(`guard 放行 run_shell: ${verdict.reason}`);
    }

    if (name.startsWith("mcp_")) {
        const originalName = name.slice(4);
        const result = await mcpClient.callTool(originalName, parameter);
        return `${name}调用结果:\n${result}`;
    }

    const tool = toolMap.get(name);
    if (!tool) {
        throw new Error(`未知工具: ${name}`);
    }
    return `${name}调用结果:\n${await tool(parameter, ctx)}`;
}
