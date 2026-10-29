/**
 * LLM 请求上下文组装
 */
import config from "../config.js";
import { skills, forceSkills } from "./skill.js";
import { mcpClient } from "./mcp-manager.js";
import type Agent from "./Agent.ts";
import type { Plan, PlanStatus } from "./types.ts";
import {listTags} from "../stickers/index.js";

const systemPrompt = config.systemPrompt;

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

type WakeTrigger = { type: string; id?: string; title?: string; prompt?: string };

/** 渲染「定时苏醒」触发说明：让模型知道自己是被闹钟叫醒的，而不是收到新消息 */
function renderTrigger(trigger: WakeTrigger | null | undefined): string | null {
    if (!trigger || trigger.type !== "schedule") return null;
    const lines = [
        "你被自己的定时闹钟叫醒了",
        `任务：${trigger.title ?? ""}`,
    ];
    if (trigger.prompt) lines.push(`备忘：${trigger.prompt}`);
    lines.push(
        "接下来由你自己判断：要不要说话、说什么，或者干脆不说" +
        "没必要每次都开口，也别刷屏。要做的事做完就好。",
    );
    return lines.join("\n");
}

/**
 * 构建发送给 LLM 的完整消息列表
 * @param agent 当前会话的 Agent
 */
export function buildMessages(agent: Agent) {
    const recorder = agent.memory;
    const activePlan = agent.getActivePlan();
    // 顺序原则：稳定内容靠前、易变内容靠后，提高服务商前缀缓存命中率。
    // 同一轮工具循环内除历史外的所有 system 块都不变，前缀可完整命中缓存。
    const messages: Array<{ role: string; content: string }> = [
        { role: "system", content: systemPrompt },
    ];

    // 强加载技能（force: true）；仅随 reloadSkills 变化，频率极低
    if (forceSkills.length > 0) {
        const forceBlock = forceSkills
            .map(s => `### ${s.name}\n${s.content}`)
            .join("\n\n");
        messages.push({ role: "system", content: `强加载技能:\n${forceBlock}` });
    }

    messages.push(
        { role: "system", content: `技能列表：${JSON.stringify(skills)}` },
        { role: "system", content: `mcp列表：${JSON.stringify(mcpClient.listServers())}` },
        { role: "system", content: `表情包tags：${JSON.stringify(listTags())}` },
    );

    if (recorder.getMidSummary()) {
        messages.push({ role: "system", content: `对话历史概要:${recorder.getMidSummary()}` });
    }

    if (activePlan) {
        messages.push({ role: "system", content: `当前任务计划：\n${renderPlan(activePlan)}\n（勿偏离目标，随进度用 manage_plan 更新状态）` });
    }

    const trigger = renderTrigger(agent.pendingTrigger);
    if (trigger) {
        messages.push({ role: "system", content: trigger });
        agent.pendingTrigger = null;
    }

    return [...messages, ...recorder.getAll()];
}
