import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "test-server", version: "1.0.0" });
server.registerTool("search", {}, async () => ({
    content: [{ type: "text", text: process.argv[2] }],
}));
await server.connect(new StdioServerTransport());
