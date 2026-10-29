import { mcpClient } from "../mcp-manager.js";
import type { ToolDefinition, ToolModule } from "../types.ts";

/** list_mcp_tools 工具入参 */
export interface ListMcpToolsParams {
    mcpName: string;
}

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "list_mcp_tools",
        description: "将指定mcp的工具加入工具列表，仅生效一次",
        parameters: {
            type: "object",
            properties: {
                mcpName: {
                    type: "string",
                    description: "mcp名称",
                },
            },
            required: ["mcpName"],
        },
    },
};

/**
 * 待注入的 mcp 工具队列（getAllTools 每次取走并清空）
 */
let mcpTools: ToolDefinition[] = [];

/**
 * 将工具追加到待注入队列
 */
export function addMcpTools(newTools: readonly ToolDefinition[]): void {
    mcpTools.push(...newTools);
}

/**
 * 取走并清空待注入的 mcp 工具
 */
export function takeMcpTools(): ToolDefinition[] {
    const rt = [...mcpTools];
    mcpTools = [];
    return rt;
}

/** 加载指定 MCP server 的工具定义并注入工具列表 */
export async function execute(param: ListMcpToolsParams): Promise<string> {
    const newTools = await mcpClient.getToolDefinitionOfServer(param.mcpName);
    addMcpTools(newTools);
    return `已将 ${param.mcpName} 的工具加入工具列表`;
}

export default { definition, execute } satisfies ToolModule<ListMcpToolsParams>;
