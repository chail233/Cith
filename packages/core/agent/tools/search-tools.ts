import { extensionRegistry } from "../extensions/registry.ts";
import type { ToolDefinition, ToolModule } from "../types.ts";
import type { ExtensionTool } from "../extensions/registry.ts";


const MAX_SCHEMA_CHARS = 2000;

export interface SearchToolsParams {
    query?: unknown;
}

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "search_tools",
        description:
            "搜索可用的MCP扩展工具。扩展工具不常驻工具表：先用本工具按关键词发现，" +
            "结果里有工具名、说明与参数格式，随后用 use_tool 调用。query 留空返回各来源总览。",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "关键词，匹配工具名与描述；留空返回来源总览" },
            },
            required: [],
        },
    },
};

export async function execute(param: SearchToolsParams): Promise<string> {
    const query = typeof param?.query === "string" ? param.query.trim() : "";

    // 空 query：给来源总览，让模型知道有哪些地方可以搜
    if (!query) {
        const overview = await extensionRegistry.overview();
        if (overview.length === 0) return "当前没有可用的扩展工具来源";
        const lines = overview.map((s) => `${s.source}（${s.description || "无描述"}）：${s.tools} 个工具`);
        return `扩展工具来源总览：\n${lines.join("\n")}\n带上关键词调用本工具可查看具体工具与参数格式。`;
    }

    const { tools, total, truncated } = await extensionRegistry.search(query);
    if (tools.length === 0) {
        return `没有匹配「${query}」的扩展工具。可换更短的关键词重搜，或留空 query 查看可用来源。`;
    }
    const tail = truncated ? `\n（共 ${total} 个匹配，仅显示前 ${tools.length} 个，请用更精确的关键词）` : "";
    return `找到 ${tools.length} 个扩展工具：\n\n${tools.map(renderCard).join("\n\n")}${tail}`;
}

/** 工具卡：名称、来源、说明、参数格式（模型照参数格式填 use_tool 的 arguments） */
function renderCard(tool: ExtensionTool): string {
    let schema = "{}";
    try {
        schema = JSON.stringify(tool.inputSchema ?? {}) || "{}";
    }
    catch { /* schema 序列化失败按空处理 */ }
    if (schema.length > MAX_SCHEMA_CHARS) schema = schema.slice(0, MAX_SCHEMA_CHARS) + "…（已截断）";
    return `【${tool.name}】来源：${tool.source}\n说明：${tool.description || "（无）"}\n参数格式：${schema}`;
}

export default { definition, execute } satisfies ToolModule<SearchToolsParams>;
