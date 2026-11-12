import { EventEmitter } from "node:events";
import { callLLM } from "./client.ts";
import { callTool, getAllTools } from "./tools.js";
import { reloadSkills, skills, forceSkills } from "./skill.js";
import { mcpClient } from "./mcp-manager.js";
import { runNotesMaintenance } from "./notes.ts";
import { renderPlanBlock, PlanBoard } from "./plan.ts";
import { readSystemPrompt } from "../services/prompt-store.ts";
import { renderNotesBlock } from "../services/notes-store.ts";
import config from "../config.js";
import logger from "../utils/logger.js";
import type { ChatRecorder } from "./recorder.js";
import type { Context, MessageSegment } from "../types/index.ts";
import type { AgentRunOutcome, AgentToolContext, HeldOutcome, LlmResult, ReplyPayload, ToolCall, ToolContext, ToolDefinition, ToolExecution, ToolHold } from "./types.ts";
import type { ReplyTool, ReplyToolResult } from "../bot/adapters/reply-tool.ts";

/** 定时苏醒的触发信息 */
type WakeTrigger = { type: string; id?: string; title?: string; prompt?: string };

export default class Agent extends EventEmitter {
    /** 会话 ID（{from}:{id}），同时作为长期记忆的派生键 */
    readonly sessionId: string;
    /** 本会话的三层记忆记录器 */
    readonly memory: ChatRecorder;
    /** 本会话的任务计划 */
    readonly planBoard = new PlanBoard();

    /** 定时苏醒注入的唤醒说明；buildMessages 读取后置空，避免污染后续对话 */
    pendingTrigger: WakeTrigger | null = null;

    constructor(opts: { sessionId: string; memory: ChatRecorder }) {
        super();
        this.sessionId = opts.sessionId;
        this.memory = opts.memory;
    }

    // ---------------------------------------------------------------- 主循环

    async run(ctx: Context): Promise<void> {
        if (!this.memory.tryBeginRequest()) {
            logger.info("会话已有模型请求进行中，跳过本次请求:", this.sessionId);
            return;
        }
        try {
            // 每回合现取：开工前重新扫描 skills 目录，保证强加载/技能列表与磁盘一致
            await reloadSkills();

            const outcome = await this.runLoop(ctx);
            if (typeof outcome === "string") {
                this.deliver([{ type: "text", data: { text: `ERROR:${outcome}` } }], 0);
                return;
            }
            // 门禁挂起：本轮不再产出回复，询问段交给分发方经适配器发出；挂起信息不进对话记忆
            if (isHeldOutcome(outcome)) {
                this.broadcast("approval", outcome.held);
                return;
            }
            this.deliver(outcome.acts, outcome.tokens);
        }
        finally {
            this.memory.endRequest();
            // 聊天阈值守护：整轮跑完后若上下文仍超阈值，先做笔记维护再后台静默摘要，
            // 都不阻塞监听器摘除与后续对话
            void this.postRunMaintenance();
        }
    }

    /**
     * 后台收尾：笔记维护
     * → 摘要压缩。笔记 pass 失败不阻塞摘要。
     */
    private async postRunMaintenance(): Promise<void> {
        try {
            await runNotesMaintenance(this);
        }
        finally {
            this.memory.maybeSummarize();
        }
    }

    /**
     * Agent 主循环：请求 → 执行工具 → 回填痕迹 → 再请求，直到拿到可直接发送的回复
     * 遇到门禁挂起时立即中断本轮，不再请求模型
     * @returns 成功时为本轮产出；请求失败时为错误文本
     */
    private async runLoop(ctx: Context): Promise<AgentRunOutcome | HeldOutcome | string> {
        const toolCtx: AgentToolContext = { ...ctx, agent: this };
        /** 当前通道的发言工具：每轮向适配器现取，Agent 不缓存也不解析它的参数结构 */
        const replyTool = resolveReplyTool(ctx.adapter);
        if (!replyTool) return "当前通道没有可用的发言工具，本轮无法回复";
        /** 本轮累计消耗 */
        let tokens = 0;
        /** 已执行的工具轮数 */
        let toolDepth = 0;
        /** 是否已因纯文本输出纠偏重试过（只重试一次，防循环） */
        let corrected = false;

        while (true) {
            // 工作阈值守护：请求前守体积，工具痕迹累积超预算时折叠最旧的部分，避免长工具链把上下文撑爆
            this.memory.compactIfNeeded(config.contextBudgetTokens);
            const result = await this.ask(this.availableTools(replyTool));
            if (typeof result === "string") return result;
            tokens += result.totalTokens;

            const calls = result.message.tool_calls ?? [];

            // 1. 一个工具都没调：正文为空是真沉默，本轮不发言；
            if (calls.length === 0) {
                const text = (result.message.content ?? "").trim();
                if (text === "") {
                    logger.info("模型未调用任何工具，本轮不发言:", this.sessionId);
                    return { acts: [], tokens };
                }
                if (!corrected) {
                    corrected = true;
                    this.memory.add({ role: "system", content: { text: `你直接输出了文本而没有调用 send_message，文本不会被发送。请用 send_message 重新发送这段内容：「${text.slice(0, 200)}」` } });
                    logger.warn("模型以纯文本作答，已回填纠偏并重试:", this.sessionId);
                    continue;
                }
                logger.warn("纠偏后模型仍以纯文本作答，桥接发送:", this.sessionId);
                return { acts: [{ type: "text", data: { text } }], tokens };
            }

            // 2. 工具链达到上限 → 强制收敛：只留发言工具再问一次，逼模型直接作答
            if (toolDepth >= config.toolChainMaxLength) {
                return this.converge(tokens, replyTool, toolCtx);
            }

            toolDepth++;

            // 3. 先把普通工具跑完（并行执行），有门禁挂起则立即中断本轮
            const replyCalls = pickReplyCalls(calls, replyTool);
            const otherCalls = calls.filter((call) => !replyCalls.includes(call));
            if (otherCalls.length > 0) {
                const holds = await this.runTools(otherCalls, toolCtx);
                if (holds.length > 0) return { held: holds };
            }

            // 4. 发言：参数合法就是一段可发的消息；全部不合法则错误已回填，继续循环让模型自修
            const acts = replyCalls.length > 0 ? await this.speak(replyCalls, replyTool, toolCtx) : null;

            // 5. 没有别的活了：发言就是本轮结论，交给 run() 统一投递
            if (otherCalls.length === 0) {
                if (acts) return { acts, tokens };
                continue;
            }

            // 6. 还有别的活没干完：这一轮的话当场发出，然后接着跑，直到只剩发言或没有工具
            if (acts && acts.length > 0) {
                this.deliver(acts, tokens);
                tokens = 0;
            }
        }
    }

    /**
     * 组装发送给 LLM 的完整消息列表
     * 稳定前缀在前（系统提示 → 技能/MCP → 笔记 → 概要）、易变项在后（计划/唤醒说明），前缀缓存友好，勿打乱顺序
     */
    private async buildMessages(): Promise<Array<{ role: string; content: string }>> {
        const messages: Array<{ role: string; content: string }> = [];
        const systemPrompt = readSystemPrompt();
        if (systemPrompt !== "") messages.push({ role: "system", content: systemPrompt });

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

        // 全局笔记：AI 自我维护，位于对话历史概要之前
        const notes = await renderNotesBlock();
        if (notes) messages.push({ role: "system", content: notes });

        const midSummary = this.memory.getMidSummary();
        if (midSummary) {
            messages.push({ role: "system", content: `对话历史概要:${midSummary}` });
        }

        const tail: Array<{ role: string; content: string }> = [];
        const activePlan = this.planBoard.getActive();
        if (activePlan) {
            tail.push({ role: "system", content: renderPlanBlock(activePlan) });
        }

        const trigger = renderTrigger(this.pendingTrigger);
        if (trigger) {
            tail.push({ role: "system", content: trigger });
        }
        this.pendingTrigger = null;

        return [...messages, ...this.memory.getAll(), ...tail];
    }

    /**
     * 请求一次模型
     * @param tools 本轮可用的工具定义
     * @returns 成功返回模型结果，失败返回错误文本（调用方只需判断 string）
     */
    private async ask(tools: ToolDefinition[]): Promise<LlmResult | string> {
        const result = await callLLM({
            model: config.chatModel,
            messages: await this.buildMessages(),
            temperature: 0.2,
            tools,
        });
        return result || "AI 服务无响应";
    }

    /**
     * 本轮工具表：发言工具排首位（随通道固定，利于前缀缓存），其后是本地工具与已激活 MCP 工具
     */
    private availableTools(replyTool: ReplyTool): ToolDefinition[] {
        return [replyTool.definition, ...getAllTools()];
    }

    /**
     * 工具链达到上限后的收敛请求：只留发言工具再问一次，逼模型直接作答
     * 收敛请求失败或模型仍不说话时，本轮不发言
     */
    private async converge(tokens: number, replyTool: ReplyTool, toolCtx: AgentToolContext): Promise<AgentRunOutcome> {
        const final = await this.ask([replyTool.definition]);
        if (typeof final === "string") {
            logger.warn("收敛请求失败，本轮不发言:", final);
            return { acts: [], tokens };
        }
        const totalTokens = tokens + final.totalTokens;
        const replyCalls = pickReplyCalls(final.message.tool_calls ?? [], replyTool);
        if (replyCalls.length > 0) {
            const acts = await this.speak(replyCalls, replyTool, toolCtx);
            if (acts) return { acts, tokens: totalTokens };
        }
        // 收敛轮没有纠偏预算：正文若已含答复文本，直接桥接成发言
        const text = (final.message.content ?? "").trim();
        if (text !== "") {
            logger.warn("收敛请求得到纯文本，桥接发送:", this.sessionId);
            return { acts: [{ type: "text", data: { text } }], tokens: totalTokens };
        }
        logger.info("收敛后模型仍未发言:", this.sessionId);
        return { acts: [], tokens: totalTokens };
    }

    // ---------------------------------------------------------------- 工具执行

    /**
     * 执行发言工具调用：按调用顺序规范化消息段
     * 规范化失败则把原因回填给模型自修
     * @returns 待发送消息段（空数组 = 模型选择本轮不发言）；全部调用都失败时返回 null（错误已回填）
     */
    private async speak(calls: ToolCall[], replyTool: ReplyTool, toolCtx: AgentToolContext): Promise<MessageSegment[] | null> {
        const acts: MessageSegment[] = [];
        let accepted = false;
        for (const call of calls) {
            const output = await runReplyCall(replyTool, call, toolCtx);
            if (typeof output === "string") {
                this.recordToolCall(call.function.name, call.function.arguments, output);
                continue;
            }
            accepted = true;
            acts.push(...output.acts);
        }
        return accepted ? acts : null;
    }

    /**
     * 执行同一轮的多个工具调用：并行执行，并按 tool_calls 原顺序回填痕迹、广播结果
     * @returns 被门禁挂起的调用；非空时调用方必须中断本轮
     */
    private async runTools(toolCalls: ToolCall[], toolCtx: AgentToolContext): Promise<ToolHold[]> {
        const executions = await Promise.all(toolCalls.map((toolCall) => this.runTool(toolCall, toolCtx)));
        const holds: ToolHold[] = [];
        for (const { toolCall, name, args, output } of executions) {
            // 挂起调用既不记录也不广播：模型不该知道它悬而未决，确认后的结果由确认链注入上下文
            if (isToolHold(output)) {
                holds.push(output);
                continue;
            }
            this.recordToolCall(name, JSON.stringify(args ?? toolCall.function.arguments), output);
            this.broadcast("tool-result", { name, args, result: output });
        }
        return holds;
    }

    /**
     * 执行单个工具调用
     * 失败不抛断整轮：把错误原因作为结果交给模型自我修正
     */
    private async runTool(toolCall: ToolCall, toolCtx: AgentToolContext): Promise<ToolExecution> {
        const name = toolCall.function.name;
        let args: Record<string, unknown> | null = null;
        try {
            args = JSON.parse(toolCall.function.arguments);
            this.broadcast("tool-call", { name, args });
            return { toolCall, name, args, output: await callTool(toolCall, toolCtx) };
        }
        catch (err) {
            logger.error("AI 工具调用失败:", name, err);
            return { toolCall, name, args, output: `工具 ${name} 执行失败：${errorMessage(err)}` };
        }
    }

    /**
     * 将一次工具调用的过程与结果回填进会话记忆
     */
    recordToolCall(toolName: string, argsText: string, result: string): void {
        this.memory.add({ role: "system", content: { text: `调用了工具 ${toolName}，参数：${argsText}，结果：${result}` } });
        logger.info("调用工具:", toolName, " 参数：", argsText, " 结果：", result);
    }

    /**
     * 记录一次被拒绝的工具调用
     * 让模型知道该操作已有结论且未运行，避免反复发起同一操作
     */
    recordToolDenial(toolName: string, argsText: string, byName: string): void {
        const who = byName.trim() || "管理员";
        const text = `工具 ${toolName} 的调用被${who}拒绝执行，参数：${argsText}，操作未运行。不要重复发起同一操作，除非用户明确要求。`;
        this.memory.add({ role: "system", content: { text } });
        logger.info("工具调用被拒绝:", toolName, " 参数：", argsText);
    }

    // ---------------------------------------------------------------- 事件

    /** 安全广播：监听器异常不得反噬 Agent 主循环 */
    private broadcast(event: string, payload: unknown): void {
        try {
            this.emit(event, payload);
        }
        catch (err) {
            logger.error(`Agent 事件监听器异常 (${event}):`, err);
        }
    }

    /**
     * 产出一轮回复：广播 "reply" 事件供分发方消费
     * 空消息段 = 模型选择本轮不发言：不广播（分发方无内容可发），但留一条记忆痕迹
     */
    private deliver(acts: MessageSegment[], tokens: number): void {
        if (acts.length === 0) {
            logger.info("本轮选择不发言:", this.sessionId);
            this.memory.add({ role: "assistant", content: { action: [], note: "本轮选择不发言" } });
            return;
        }
        const payload: ReplyPayload = { acts, tokens };
        this.broadcast("reply", payload);
        this.memory.add({ role: "assistant", content: { action: acts } });
        this.memory.msgWithoutChat = 0;
    }
}

// ---------------------------------------------------------------- 模块内工具函数

/** 统一提取异常信息文本 */
function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

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

/** 守卫：工具调用结果是否为门禁挂起 */
function isToolHold(value: unknown): value is ToolHold {
    return typeof value === "object" && value !== null && (value as { held?: unknown }).held === true;
}

/** 守卫：主循环是否因门禁挂起而中止 */
function isHeldOutcome(value: AgentRunOutcome | HeldOutcome): value is HeldOutcome {
    return Array.isArray((value as HeldOutcome).held);
}

/** 从适配器取发言工具；没有适配器或适配器生成失败时返回 null，本轮无法发言 */
function resolveReplyTool(adapter: Context["adapter"] | undefined): ReplyTool | null {
    if (!adapter) return null;
    try {
        return adapter.replyTool();
    }
    catch (err) {
        logger.error("适配器生成发言工具失败:", err);
        return null;
    }
}

/** 挑出本轮工具调用里哪些是发言调用 */
function pickReplyCalls(calls: ToolCall[], replyTool: ReplyTool): ToolCall[] {
    const name = replyTool.definition.function.name;
    return calls.filter((call) => call.function.name === name);
}

/** 单次发言调用：参数解析与执行异常统一转成错误文本，不抛断整轮 */
async function runReplyCall(replyTool: ReplyTool, call: ToolCall, ctx: ToolContext): Promise<ReplyToolResult> {
    let param: unknown;
    try {
        param = JSON.parse(call.function.arguments);
    }
    catch {
        return "参数不是合法 JSON，请按工具定义重新填写 segments";
    }
    try {
        return await replyTool.execute(param, ctx);
    }
    catch (err) {
        return `发言工具执行失败：${errorMessage(err)}`;
    }
}
