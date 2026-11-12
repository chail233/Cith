/**
 * LLM 请求上下文组装
 */
import { skills, forceSkills } from "./skill.js";
import { mcpClient } from "./mcp-manager.js";
import { readSystemPrompt } from "../services/prompt-store.ts";
import { renderNotes } from "../services/notes-store.ts";
import { renderPlan } from "./plan.ts";
import type Agent from "./Agent.ts";

type WakeTrigger = { type: string; id?: string; title?: string; prompt?: string };

/** 渲染 MCP 服务器清单：名称 + 描述 + 激活状态 */
function renderMcpServers(): string {
    const servers = mcpClient.listServers();
    if (servers.length === 0) return "无";
    return servers
        .map((s) => `${s.name}${s.description ? `（${s.description}）` : ""}${mcpClient.isActive(s.name) ? "[已激活]" : ""}`)
        .join("、");
}

/** 渲染「定时苏醒」触发说明：让模型知道自己是被闹钟叫醒的，而不是收到新消息 */
function renderTrigger(trigger: WakeTrigger | null | undefined): string | null {
    if (!trigger || trigger.type !== "schedule") return null;
    const lines = [
        "你被自己的定时闹钟叫醒了",
        `任务：${trigger.title ?? ""}`,
    ];
    if (trigger.prompt) lines.push(`备忘：${trigger.prompt}`);
    lines.push(
        "接下来由你自己决定行为"
    );
    return lines.join("\n");
}

/**
 * 构建发送给 LLM 的完整消息列表
 * @param agent 当前会话的 Agent
 * @param opts.notesPass 笔记维护 pass：复用上下文但去除技能/MCP 清单（与笔记维护无关的噪声）
 */
export async function buildMessages(agent: Agent, opts: { notesPass?: boolean } = {}): Promise<Array<{ role: string; content: string }>> {
    const recorder = agent.memory;
    const activePlan = agent.planBoard.getActive();
    const messages: Array<{ role: string; content: string }> = [];
    const systemPrompt = readSystemPrompt();
    if (systemPrompt !== "") messages.push({ role: "system", content: systemPrompt });

    if (!opts.notesPass) {
        if (forceSkills.length > 0) {
            const forceBlock = forceSkills
                .map(s => `### ${s.name}\n${s.content}`)
                .join("\n\n");
            messages.push({ role: "system", content: `强加载技能:\n${forceBlock}` });
        }

        messages.push(
            { role: "system", content: `技能列表：${JSON.stringify(skills)}` },
            { role: "system", content: `mcp列表：${renderMcpServers()}` },
        );
    }

    // 全局笔记：AI 自我维护，位于对话历史概要之前；维护 pass 也依赖它看到当前笔记
    const notes = await renderNotes();
    if (notes !== "") {
        messages.push({ role: "system", content: `你的笔记（全局，由你自己维护）：\n${notes}` });
    }

    if (recorder.getMidSummary()) {
        messages.push({ role: "system", content: `对话历史概要:${recorder.getMidSummary()}` });
    }

    const tail: Array<{ role: string; content: string }> = [];
    if (activePlan) {
        tail.push({ role: "system", content: `当前任务计划：\n${renderPlan(activePlan)}\n（勿偏离目标，随进度用 manage_plan 更新状态）` });
    }

    const trigger = renderTrigger(agent.pendingTrigger);
    if (trigger) {
        tail.push({ role: "system", content: trigger });
    }
    agent.pendingTrigger = null;

    return [...messages, ...recorder.getAll(), ...tail];
}
