/**
 * 简易日志封装
 * 统一输出格式，方便后续扩展（写入文件、日志级别等）
 */

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const CURRENT_LEVEL = LOG_LEVELS.DEBUG;

// 向面板事件总线推送结构化日志
import { publish } from "../api/event-bus.ts";

function timestamp() {
    return new Date().toISOString();
}

/** 将日志参数安全序列化为字符串，供面板展示 */
function serialize(
    /** @type {unknown[]} */ args,
) {
    return args
        .map((/** @type {unknown} */ a) => {
            if (typeof a === "string") return a;
            if (a instanceof Error) return a.stack || a.message;
            try {
                return JSON.stringify(a);
            }
            catch {
                return String(a);
            }
        })
        .join(" ");
}

export const logger = {
    /** @param {...any} args */
    debug(...args) {
        if (CURRENT_LEVEL <= LOG_LEVELS.DEBUG) {
            console.log(`[${timestamp()}] [DEBUG]`, ...args);
            publish("log", { level: "DEBUG", ts: Date.now(), msg: serialize(args) });
        }
    },
    /** @param {...any} args */
    info(...args) {
        if (CURRENT_LEVEL <= LOG_LEVELS.INFO) {
            console.log(`[${timestamp()}] [INFO]`, ...args);
            publish("log", { level: "INFO", ts: Date.now(), msg: serialize(args) });
        }
    },
    /** @param {...any} args */
    warn(...args) {
        if (CURRENT_LEVEL <= LOG_LEVELS.WARN) {
            console.warn(`[${timestamp()}] [WARN]`, ...args);
            publish("log", { level: "WARN", ts: Date.now(), msg: serialize(args) });
        }
    },
    /** @param {...any} args */
    error(...args) {
        if (CURRENT_LEVEL <= LOG_LEVELS.ERROR) {
            console.error(`[${timestamp()}] [ERROR]`, ...args);
            publish("log", { level: "ERROR", ts: Date.now(), msg: serialize(args) });
        }
    },
};

export default logger;