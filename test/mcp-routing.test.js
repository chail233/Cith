import test from "node:test";
import assert from "node:assert/strict";
import { McpClientManager } from "../core/agent/mcp-manager.js";
import { fileURLToPath } from "node:url";
const logger = { info() {}, warn() {}, error() {}, debug() {} };

test("routes calls over real MCP stdio connections", async () => {
    const fixture = fileURLToPath(new URL("../fixtures/mcp-server.mjs", import.meta.url));
    const config = { mcpServers: ["one", "two"].map(name => ({ name, command: process.execPath, args: [fixture, name] })) };
    const manager = new McpClientManager(config, logger);
    try {
        await manager.init();
        for (const server of config.mcpServers) {
            const definitions = await manager.getToolDefinitionOfServer(server.name);
            assert.equal(definitions.length, 1);
            assert.equal(await manager.callTool(definitions[0].function.name.slice(4), {}), server.name);
        }
    } finally {
        await manager.shutdown();
    }
});

test("routes same-named tools to their own server with valid stable names", async () => {
    const names = ["server one", "server_one", "x".repeat(100)];
    const tools = new Map(names.map(name => [name, [{ name: "search", inputSchema: { type: "object" } }]]));
    const calls = [];
    const config = { mcpServers: names.map(name => ({ name })) };
    const warnings = [];
    const manager = new McpClientManager(config, { ...logger, warn: message => warnings.push(message) }, ({ name }) => ({
        connect: async () => {},
        listTools: async () => tools.get(name),
        callTool: async (tool, args) => { calls.push([name, tool, args]); return name; },
        close: async () => {},
    }));
    await manager.init();
    assert.ok(warnings.some(message => message.includes("search")));
    const all = await manager.getToolDefinition();
    const exposed = all.map(item => item.function.name);
    assert.equal(new Set(exposed).size, 3);
    for (const name of exposed) assert.match(name, /^[a-zA-Z0-9_-]{1,64}$/);
    for (const [index, server] of names.entries()) {
        const definitions = await manager.getToolDefinitionOfServer(server);
        assert.equal(definitions[0].function.name, exposed[index]);
        assert.equal(await manager.callTool(exposed[index].slice(4), { q: index }), server);
    }
    assert.deepEqual(calls, names.map((name, index) => [name, "search", { q: index }]));
    assert.match(await manager.callTool("search", {}), /未找到/);
    tools.get(names[0]).push({ name: "new/tool" });
    const added = await manager.getToolDefinitionOfServer(names[0]);
    assert.equal(await manager.callTool(added[1].function.name.slice(4), {}), names[0]);
    tools.set(names[0], [{ name: "new/tool" }]);
    await manager.getToolDefinitionOfServer(names[0]);
    assert.match(await manager.callTool(exposed[0].slice(4), {}), /未找到/);
    await manager.shutdown();
    assert.equal((await manager.getToolDefinition()).length, 0);
});

test("closes a connection whose tool discovery fails", async () => {
    let closed = false;
    const manager = new McpClientManager({ mcpServers: [{ name: "broken" }] }, logger, () => ({
        connect: async () => {}, listTools: async () => { throw new Error("failed"); },
        close: async () => { closed = true; },
    }));
    await manager.init();
    assert.equal(closed, true);
    assert.deepEqual(await manager.getToolDefinition(), []);
});

test("legacy names work only when unambiguous", async () => {
    const config = { mcpServers: [{ name: "one" }] };
    const manager = new McpClientManager(config, logger, () => ({
        connect: async () => {}, listTools: async () => [{ name: "search" }],
        callTool: async name => name, close: async () => {},
    }));
    await manager.init();
    assert.equal(await manager.callTool("search", {}), "search");
    await manager.shutdown();
    await manager.init();
    assert.equal(await manager.callTool("search", {}), "search");
    await manager.shutdown();
});

test("concurrent server discovery retains both routes", async () => {
    const config = { mcpServers: [{ name: "one" }, { name: "two" }] };
    const manager = new McpClientManager(config, logger, ({ name }) => ({
        connect: async () => {}, listTools: async () => [{ name: "search" }],
        callTool: async () => name, close: async () => {},
    }));
    await manager.init();
    const definitions = await Promise.all(config.mcpServers.map(server => manager.getToolDefinitionOfServer(server.name)));
    assert.deepEqual(await Promise.all(definitions.map(group => manager.callTool(group[0].function.name.slice(4), {}))), ["one", "two"]);
    await manager.shutdown();
});
