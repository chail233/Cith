/**
 * LLM 请求上下文组装
 */
import config from "../config.js";
import { skills, forceSkills } from "./skill.js";
import { mcpClient } from "./mcp-client.js";
import type Agent from "./Agent.ts";
import type { Plan, PlanStatus } from "./types.ts";

const SYSTEM_PROMPT = config.SYSTEM_PROMPT;

/** 合法状态 → 渲染图标 */
const STATUS_ICONS: Record<PlanStatus, string> = {
    pending: "○",
    in_progress: "→",
    done: "✓",
    cancelled: "✗",
};

/** 渲染计划为文本（目标行 + 步骤清单）；无目标时仅渲染步骤 */
export function renderPlan(plan: Plan): string {
    const steps = plan.items.map((t) => `${STATUS_ICONS[t.status]} ${t.content}`).join("\n");
    return plan.goal ? `目标：${plan.goal}\n${steps}` : steps;
}

/**
 * 构建发送给 LLM 的完整消息列表
 * @param agent 当前会话的 Agent
 */
export function buildMessages(agent: Agent) {
    const recorder = agent.memory;
    const activePlan = agent.getActivePlan();
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
    if (activePlan) {
        messages.push({ role: "system", content: `当前任务计划：\n${renderPlan(activePlan)}\n（勿偏离目标，随进度用 manage_plan 更新状态）` });
    }

    return [...messages, ...recorder.getAll()];
}
