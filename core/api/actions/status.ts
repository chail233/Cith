/**
 * status action：Bot 运行状态只读查询
 */
import { mcpClient } from "../../agent/mcp-client.js";
import { runtimeState } from "../runtime-state.ts";
import { registerAction } from "../router.ts";

registerAction("get_status", () => {
    const mcpConnections = mcpClient?.connections?.size ?? 0;
    return {
        uptimeMs: Date.now() - runtimeState.startedAt,
        onebotConnected: runtimeState.onebotConnected,
        mcpConnections,
        memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        nodeVersion: process.version,
    };
});
