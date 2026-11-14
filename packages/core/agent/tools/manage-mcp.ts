/**
 * manage_mcp：维护 MCP 激活列表
 */
import { mcpClient } from "../mcp-manager.js";
import type { ToolDefinition, ToolModule } from "../types.ts";

/** manage_mcp 工具入参 */
export interface ManageMcpParams {
    action?: string;
    mcpName?: string;
}

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "manage_mcp",
        description:
            "管理哪些 MCP 服务器的工具进入你的工具列表：" +
            "activate 激活后该服务器的工具立刻可调用；deactivate 用完移出，避免工具列表长期变长。",
        parameters: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    enum: ["activate", "deactivate"],
                    description: "操作类型",
                },
                mcpName: {
                    type: "string",
                    description: "服务器名，见上下文 mcp列表",
                },
            },
            required: ["action", "mcpName"],
        },
    },
};

export async function execute(param: ManageMcpParams): Promise<string> {
    const action = String(param?.action ?? "").trim().toLowerCase();
    const name = String(param?.mcpName ?? "").trim();
    const servers = mcpClient.listServers();

    if (!name) return "缺少参数 mcpName（服务器名）";
    if (action !== "activate" && action !== "deactivate") {
        return `未知 action：${action || "（空）"}，可选 activate / deactivate`;
    }
    if (!servers.some((s) => s.name === name)) {
        const names = servers.map((s) => s.name).join("、");
        return `未找到服务器 ${name}，可用：${names || "无"}`;
    }

    if (action === "activate") {
        const result = await mcpClient.activate(name);
        if (!result.ok) return `激活 ${name} 失败：${result.reason}`;
        const names = result.tools.map((t) => t.function.name);
        return names.length > 0
            ? `已激活 ${name}，工具已进入工具列表：${names.join("、")}`
            : `已激活 ${name}，但它没有提供工具`;
    }
    return mcpClient.deactivate(name) ? `已取消激活 ${name}` : `${name} 当前未激活`;
}

export default { definition, execute } satisfies ToolModule<ManageMcpParams>;
