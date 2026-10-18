import logger from "./utils/logger.js";
import { startOneBotServer } from "./bot/servers/OnebotServer.js";
import runPipeline from "./pipeline/index.js";
import {mcpClient} from "./agent/mcp-client.js";
import { startApiServer } from "./api/server.ts";
import startWechatBotServer from "./bot/servers/WechatBotServer.ts";

logger.info("SunbatwoBot 启动中...");

await mcpClient.init();

// 启动 WebSocket 服务，使用管道模式处理事件
startOneBotServer(runPipeline);
startWechatBotServer(runPipeline);

// 启动面板 API WebSocket 服务
const apiServer = startApiServer();

// 进程退出时清理 MCP 子进程与面板 API 服务，防止僵尸进程/句柄泄漏
const cleanup = async (signal) => {
    logger.info(`收到 ${signal} 信号，正在关闭...`);
    try { apiServer.close(); } catch { /* ignore */ }
    await mcpClient.shutdown();
    process.exit(0);
};

process.on('SIGINT', () => cleanup('SIGINT'));
process.on('SIGTERM', () => cleanup('SIGTERM'));
process.on('uncaughtException', async (err) => {
    logger.error('未捕获的异常:', err);
    await mcpClient.shutdown();
    process.exit(1);
});