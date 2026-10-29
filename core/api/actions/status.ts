/**
 * status action：Bot 运行状态只读查询
 */
import { mcpClient } from "../../agent/mcp-manager.js";
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
        // 启动自检结果：面板需常驻展示，否则「配错了但一切正常」极难发现
        configWarnings: runtimeState.configWarnings,
    };
});
