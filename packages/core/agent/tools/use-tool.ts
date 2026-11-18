import { extensionRegistry } from "../extensions/registry.ts";
import type { ToolContext, ToolDefinition, ToolModule } from "../types.ts";

export interface UseToolParams {
    name?: unknown;
    arguments?: unknown;
}

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "use_tool",
        description:
            "调用通过 search_tools 发现的MCP扩展工具。name 填搜索结果里的工具名，" +
            "arguments 按该工具卡的参数格式传对象。调用未发现的工具会报错并列出可用来源。",
        parameters: {
            type: "object",
            properties: {
                name: { type: "string", description: "扩展工具名，来自 search_tools 的结果" },
                arguments: { type: "object", description: "目标工具的参数对象，按其参数格式填写" },
            },
            required: ["name"],
        },
    },
};

export async function execute(param: UseToolParams, ctx?: ToolContext): Promise<string> {
    const name = typeof param?.name === "string" ? param.name.trim() : "";
    if (!name) return "缺少参数 name：先用 search_tools 发现扩展工具，再把工具名填进来";

    // arguments 归一化：只接受对象；个别服务商会把对象序列化成 JSON 字符串，这里兜一手
    const raw = param?.arguments;
    let args: Record<string, unknown> = {};
    if (typeof raw === "string") {
        try {
            args = JSON.parse(raw) as Record<string, unknown>;
        }
        catch {
            return "arguments 是字符串但不是合法 JSON：请直接传参数对象";
        }
    }
    else if (raw !== null && raw !== undefined) {
        if (typeof raw !== "object" || Array.isArray(raw)) return "arguments 必须是参数对象（JSON object）";
        args = raw as Record<string, unknown>;
    }
    const tool = await extensionRegistry.get(name);
    if (!tool) {
        const overview = await extensionRegistry.overview();
        const sources = overview.map((s) => `${s.source}（${s.tools} 个工具）`).join("、");
        return `扩展工具 ${name} 未找到。请先用 search_tools 发现可用工具` +
            (sources ? `；当前来源：${sources}` : "；当前没有可用来源");
    }
    return await extensionRegistry.invoke(name, args, ctx?.signal);
}

export default { definition, execute } satisfies ToolModule<UseToolParams>;
