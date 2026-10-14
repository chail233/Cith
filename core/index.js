import logger from "./utils/logger.js";
import { startOneBotServer } from "./bot/server.js";
import runPipeline from "./pipeline/index.js";
import {mcpClient} from "./llm/mcp-client.js";

logger.info("SunbatwoBot 启动中...");

await mcpClient.init();

// 启动 WebSocket 服务，使用管道模式处理事件
startOneBotServer(runPipeline);

// 进程退出时清理 MCP 子进程，防止僵尸进程
const cleanup = async (signal) => {
    logger.info(`收到 ${signal} 信号，正在关闭...`);
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