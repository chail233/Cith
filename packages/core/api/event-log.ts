/**
 * 全局事件日志缓冲：供 Web 后端断线重连后按时间戳补拉
 */
import config from "../config.js";
import { RingBuffer } from "./ring-buffer.ts";
import type { EventFrame } from "./types.ts";

const capacity = (config.web?.logBufferSize as number) ?? 1000;

/** 模块级单例：Bot 进程内共享一份缓冲 */
export const eventLog = new RingBuffer<EventFrame>(capacity);
