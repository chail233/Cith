/**
 * LLM 请求上下文组装
 */
import config from "../config.js";
import { skills, forceSkills } from "../llm/skill.js";
import { getActivePlan, renderPlan } from "../llm/plan.ts";
import { mcpClient } from "../llm/mcp-client.js";
import type { ChatRecorder } from "../llm/recorder.js";

const SYSTEM_PROMPT = config.SYSTEM_PROMPT;

/**
 * 构建发送给 LLM 的完整消息列表
 * @param recorder 当前会话的短期记忆记录器
 */
export function buildMessages(recorder: ChatRecorder) {
    const messages: Array<{ role: string; content: string }> = [
        { role: "system", content: SYSTEM_PROMPT },
    ];

    // 强加载技能（force: true）
    if (forceSkills.length > 0) {
        const forceBlock = forceSkills
            .map(s => `### ${s.name}\n${s.content}`)
            .join("\n\n");
        messages.push({ role: "system", content: `强加载技能:\n${forceBlock}` });
    }

    messages.push(
        { role: "system", content: `技能列表：${JSON.stringify(skills)}` },
        { role: "system", content: `mcp列表：${JSON.stringify(mcpClient.listServers())}` },
    );

    if (recorder.getMidSummary()) {
        messages.push({ role: "system", content: `对话历史概要:${recorder.getMidSummary()}` });
    }

    // 活跃任务计划每轮回注上下文（含目标），防止长工具链中目标丢失；全部完成后不再注入
    const plan = getActivePlan(recorder.sessionId);
    if (plan) {
        messages.push({ role: "system", content: `当前任务计划：\n${renderPlan(plan)}\n（勿偏离目标，随进度用 manage_plan 更新状态）` });
    }

    return [...messages, ...recorder.getAll()];
}
