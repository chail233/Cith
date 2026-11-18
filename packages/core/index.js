import logger from "./utils/logger.js";
import config from "./config.js";
import { startOneBotServer } from "./bot/servers/OnebotServer.ts";
import runPipeline from "./pipeline/index.js";
import { extensionRegistry } from "./agent/extensions/registry.ts";
import { startApiServer } from "./api/server.ts";
import { setShutdownHandler } from "./api/actions/shutdown.ts";
import startWechatBotServer from "./bot/servers/WechatBotServer.ts";
import { startDesktopServer } from "./bot/servers/DesktopServer.ts";
import { startScheduler, stopScheduler } from "./services/scheduler.js";
import { wakeUp } from "./services/wake.js";
import { runPreflight } from "./services/preflight.ts";
import { initMemoryStore, maintainMemoryStore, closeMemoryStore } from "./services/memory-store.ts";

logger.info("SunbatwoBot 启动中...");

runPreflight();

// 长期记忆：进程内单例（初始化失败只降级，不阻塞启动）
await initMemoryStore();
void maintainMemoryStore();

// 扩展工具来源（MCP 等）：启动连接
await extensionRegistry.init();

if (config.enableOnebot) startOneBotServer(runPipeline);
else logger.info("enableOnebot=false，跳过 QQ 接入服务");
if (config.enableWechat) startWechatBotServer(runPipeline);
else logger.info("enableWechat=false，跳过微信接入");
startDesktopServer(runPipeline);

// 启动面板 API WebSocket 服务
const apiServer = startApiServer();

await startScheduler({ onFire: wakeUp });

const cleanup = async (signal) => {
    logger.info(`收到 ${signal} 信号，正在关闭...`);
    try { apiServer.close(); } catch { /* ignore */ }
    stopScheduler();
    await closeMemoryStore();
    await extensionRegistry.shutdown();
    process.exit(0);
};

// 优雅退出钩子：shutdown action（桌面客户端停止内置 core）复用同一条清理链
setShutdownHandler(() => cleanup("shutdown"));
process.on('SIGINT', () => cleanup('SIGINT'));
process.on('SIGTERM', () => cleanup('SIGTERM'));
process.on('uncaughtException', async (err) => {
    logger.error('未捕获的异常:', err);
    await closeMemoryStore();
    await extensionRegistry.shutdown();
    process.exit(1);
});