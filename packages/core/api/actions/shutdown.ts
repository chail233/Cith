import { registerAction } from "../router.ts";

/** 退出钩子：由 index.js 注册为主循环的 cleanup */
let shutdownHandler: (() => void | Promise<void>) | null = null;

export function setShutdownHandler(handler: (() => void | Promise<void>) | null): void {
    shutdownHandler = handler;
}

registerAction("shutdown", async () => {
    if (!shutdownHandler) throw new Error("退出钩子未注册，无法优雅停止");
    // 异步触发，让本帧先正常返回，进程随后自行退出
    setTimeout(() => void shutdownHandler?.(), 50);
    return { stopping: true };
});
