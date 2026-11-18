import { mcpClient } from "./mcp-manager.ts";
import type { DiscoveredTool } from "./mcp-manager.ts";
import type { ExtensionProvider, ExtensionTool } from "./registry.ts";

/** mcp-manager 工具清单 → 扩展工具卡 */
function toTool(item: DiscoveredTool): ExtensionTool {
    return {
        name: item.name,
        source: item.serverName,
        description: item.description,
        inputSchema: item.inputSchema,
    };
}

export function createMcpProvider(): ExtensionProvider {
    return {
        id: "mcp",

        async init() {
            await mcpClient.init();
        },

        async shutdown() {
            await mcpClient.shutdown();
        },

        async overview() {
            // 只列已连接的 server：配了但连不上的来源列出来反而误导模型
            const items = await mcpClient.listDiscoveredTools();
            const counts = new Map<string, number>();
            for (const item of items) {
                counts.set(item.serverName, (counts.get(item.serverName) ?? 0) + 1);
            }
            const descriptions = new Map(mcpClient.listServers().map((s) => [s.name, s.description ?? ""]));
            return [...counts.entries()].map(([source, tools]) => ({
                source,
                description: descriptions.get(source) ?? "",
                tools,
            }));
        },

        async search(query) {
            const items = await mcpClient.listDiscoveredTools();
            return items
                .filter((t) => t.name.toLowerCase().includes(query) || t.description.toLowerCase().includes(query))
                .map(toTool);
        },

        async get(name) {
            const found = (await mcpClient.listDiscoveredTools()).find((t) => t.name === name);
            return found ? toTool(found) : null;
        },

        async invoke(name, args, signal) {
            // name 带 mcp_ 前缀；mcp-manager.callTool 按去前缀的 key 精确路由（歧义已在 manager 内处理）
            return await mcpClient.callTool(name.slice(4), args, signal);
        },
    };
}
