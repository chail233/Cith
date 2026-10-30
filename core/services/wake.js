import logger from "../utils/logger.js";
import config from "../config.js";
import sleep from "../utils/sleep.js";
import { nowTime } from "../utils/time.js";
import { getAgent } from "../agent/AgentManager.ts";
import { runAgent } from "../pipeline/agent-runner.js";
import { resolveAdapter } from "./adapter-registry.js";


/** 同一会话的苏醒串行队列：sessionIdOf(space) -> Promise 尾 */
const wakeQueues = new Map();
/** 会话忙时最多等待时长，超时放弃本次苏醒（触发消息不注入，记忆不受污染） */
const WAKE_MAX_WAIT_MS = 3 * 60 * 1000;
/** 等待会话空闲的轮询间隔 */
const WAKE_POLL_INTERVAL_MS = 2000;

/** 等待会话空闲（无进行中的模型请求）；超时返回 false */
async function waitIdle(agent) {
    const deadline = Date.now() + WAKE_MAX_WAIT_MS;
    while (agent.memory.isRequesting) {
        if (Date.now() >= deadline) return false;
        await sleep(WAKE_POLL_INTERVAL_MS);
    }
    return true;
}

/**
 * 触发一次苏醒；同一会话内多个苏醒按触发顺序串行执行
 * @returns 是否成功执行（通道缺失或等待超时返回 false）
 */
export function wakeUp(task) {
    const adapter = resolveAdapter(task.space);
    if (!adapter) {
        logger.warn(`定时苏醒失败：没有可用的发送通道（${task.space.from}:${task.space.id}）`);
        return Promise.resolve(false);
    }
    // Promise 链尾部追加：排队到本会话上一个苏醒之后，错误吞掉不断链
    const key = `${task.space.from}:${task.space.id}`;
    const prev = wakeQueues.get(key) ?? Promise.resolve();
    const job = prev.then(() => doWake(task, adapter));
    wakeQueues.set(key, job.then(() => undefined, () => undefined));
    return job;
}

async function doWake(task, adapter) {
    const agent = getAgent(task.space);
    if (!(await waitIdle(agent))) {
        logger.warn(`定时苏醒放弃：会话忙超时（${task.space.from}:${task.space.id}）: ${task.id} ${task.title}`);
        return false;
    }
    const prompt = String(task.prompt ?? "").trim();
    agent.pendingTrigger = {
        type: "schedule",
        id: task.id,
        title: task.title,
        prompt,
    };
    agent.memory.add({
        role: "user",
        content: {
            name: "定时苏醒",
            id: "schedule",
            time: nowTime(),
            text: prompt || `（闹钟响了：${task.title}）`,
        },
    });
    const ctx = {
        adapter,
        space: task.space,
        text: prompt,
        senderName: "定时苏醒",
        userId: String(config.selfId ?? "bot"),
        isAdmin: true,
        isTarget: true,
        at: null,
        imageDescription: null,
        handled: false,
        seg: [],
        trigger: { type: "schedule", id: task.id, title: task.title },
    };
    logger.info(`定时苏醒：${task.id} ${task.title} → ${task.space.from}:${task.space.id}`);
    await runAgent(ctx);
    return true;
}