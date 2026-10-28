import logger from "../utils/logger.js";
import config from "../config.js";
import { nowTime } from "../utils/time.js";
import { getAgent } from "../agent/AgentManager.ts";
import { runAgent } from "../pipeline/agent-runner.js";
import { resolveAdapter } from "./adapter-registry.js";

/**
 * 苏醒执行器：把「到点了」翻译成一次正常的 Agent 运行。
 * - 复用 runAgent，所以能调工具、能发表情包、能走 replyParser
 * - 通过 agent.pendingTrigger 告诉 model 自己为什么醒（contextBuilder 消费后清空）
 * - 说话与否交给 model 自己决定
 */
export async function wakeUp(task) {
    const adapter = resolveAdapter(task.space);
    if (!adapter) {
        logger.warn(`定时苏醒失败：没有可用的发送通道（${task.space.from}:${task.space.id}）`);
        return false;
    }
    const agent = getAgent(task.space);
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