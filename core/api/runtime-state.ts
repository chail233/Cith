/**
 * Bot 运行时共享状态：供 API 层读取的轻量状态快照
 */
export const runtimeState = {
    startedAt: Date.now(),
    onebotConnected: false,
};
