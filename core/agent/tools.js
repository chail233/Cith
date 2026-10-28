import config from "../config.js";
import { resolveSrcPath, checkPathWhitelist } from "../utils/file-security.js";
import { mcpClient } from "./mcp-client.js";
import { hold } from "./tool-approval.js";
import { takeMcpTools } from "./tools/list-mcp-tools.ts";

import getMemoryTool from "./tools/get-memory.ts";
import getUserProfileTool from "./tools/get-user-profile.ts";
import readFileTool from "./tools/read-file.ts";
import runJsTool from "./tools/run-js.ts";
import createFileTool from "./tools/create-file.ts";
import deleteFileTool from "./tools/delete-file.ts";
import listFilesTool from "./tools/list-files.ts";
import editFileTool from "./tools/edit-file.ts";
import listMcpToolsTool from "./tools/list-mcp-tools.ts";
import getStickersTool from "./tools/get-stickers.ts";
import managePlanTool from "./tools/manage-plan.ts";
import scheduleTool from "./tools/schedule.ts";

/**
 * 工具注册表：每个条目包含 definition（工具上下文/参数定义）和 execute（实现）
 */
const toolRegistry = [
    getMemoryTool,
    getUserProfileTool,
    readFileTool,
    runJsTool,
    createFileTool,
    deleteFileTool,
    listFilesTool,
    editFileTool,
    listMcpToolsTool,
    getStickersTool,
    managePlanTool,
    scheduleTool,
];

/**
 * 模型可以调用的工具定义列表
 */
const tools = toolRegistry.map((t) => t.definition);

const toolMap = new Map(
    toolRegistry.map((t) => [t.definition.function.name, t.execute]),
);

export function getAllTools() {
    return [...tools, ...takeMcpTools()];
}

/**
 * 细粒度文件工具 → 执行对象所属白名单目录的配置键
 * 门禁统一在 callTool：对象在白名单内直接放行，否则挂起待管理员确认
 */
const pathToolWhitelist = {
    read_file: { dirKey: "readFileDirs", pathKey: "filepath" },
    list_files: { dirKey: "readFileDirs", pathKey: "dirpath" },
    run_JS: { dirKey: "runJsDirs", pathKey: "filepath" },
    create_file: { dirKey: "editFileDirs", pathKey: "filepath" },
    delete_file: { dirKey: "editFileDirs", pathKey: "filepath" },
    edit_file: { dirKey: "editFileDirs", pathKey: "filepath" },
};


/**
 * 调用工具
 * @param {import("./types.ts").ToolCall} tool_call 完整的工具调用对象 { id, function: { name, arguments } }
 * @param {import("../types/index.ts").Context & {agent?: import("./Agent.ts").default}} [ctx] 请求上下文
 * @param {boolean} [confirmed=false] 是否已确认
 */
export async function callTool(tool_call, ctx, confirmed = false){
    const name = tool_call.function.name;
    const parameter = JSON.parse(tool_call.function.arguments);

    // 安全门禁：非管理员且未确认时，文件类工具按"执行对象是否在对应白名单内"决定放行或挂起
    if (!confirmed && !ctx?.isAdmin) {
        const rule = pathToolWhitelist[name];
        if (rule) {
            // 细粒度文件工具：对象在白名单目录内 → 放行；否则挂起待确认
            const pathArg = parameter[rule.pathKey];
            const resolved = pathArg ? resolveSrcPath(pathArg) : null;
            if (resolved && !resolved.error) {
                const whitelist = config[rule.dirKey] ?? [];
                const allowed = !checkPathWhitelist(resolved.fullPath, whitelist).error;
                if (!allowed) {
                    const id = hold(tool_call, ctx);
                    if (!id) return `${name} 被拒绝：待确认队列已满，请稍后再试`;
                    return `操作对象不在白名单目录内，需要管理员确认。已登记为待确认操作 #${id}。`;
                }
            }
            // 路径非法或缺参：交由工具自身返回具体错误
        }
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
