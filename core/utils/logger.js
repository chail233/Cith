// @ts-check

/**
 * 简易日志封装
 * 统一输出格式，方便后续扩展（写入文件、日志级别等）
 */

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const CURRENT_LEVEL = LOG_LEVELS.DEBUG;

function timestamp() {
    return new Date().toISOString();
}

export const logger = {
    debug(...args) {
        if (CURRENT_LEVEL <= LOG_LEVELS.DEBUG) {
            console.log(`[${timestamp()}] [DEBUG]`, ...args);
        }
    },
    info(...args) {
        if (CURRENT_LEVEL <= LOG_LEVELS.INFO) {
            console.log(`[${timestamp()}] [INFO]`, ...args);
        }
    },
    warn(...args) {
        if (CURRENT_LEVEL <= LOG_LEVELS.WARN) {
            console.warn(`[${timestamp()}] [WARN]`, ...args);
        }
    },
    error(...args) {
        if (CURRENT_LEVEL <= LOG_LEVELS.ERROR) {
            console.error(`[${timestamp()}] [ERROR]`, ...args);
        }
    },
};

export default logger;