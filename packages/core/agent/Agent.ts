import { EventEmitter } from "node:events";
import { callLLM } from "./client.ts";
import { callTool, getAllTools } from "./tools.js";
import { reloadSkills, skills } from "./skill.js";
import { extensionRegistry } from "./extensions/registry.ts";
import { runNotesMaintenance } from "./notes.ts";
import { renderPlanBlock, PlanBoard } from "./plan.ts";
import { readSystemPrompt } from "../services/prompt-store.ts";
import { renderNotesBlock } from "../services/notes-store.ts";
import config from "../config.js";
import logger from "../utils/logger.js";
import type { ChatRecorder } from "./recorder.js";
import type { Context, MessageSegment } from "../types/index.ts";
import type { ChatMessage, ToolCall, ToolContext, ToolDefinition, ToolHold, ToolCallResult } from "./types.ts";
import type { LlmResult } from "./client.ts";
import type { ExtensionOverviewEntry } from "./extensions/registry.ts";
import type { ReplyTool, ReplyToolResult } from "../bot/adapters/reply-tool.ts";

export interface ToolExecution {
    toolCall: ToolCall;
    args: Record<string, unknown> | null;
    output: ToolCallResult;
    durationMs: number;
    ok: boolean;
}

export interface ToolReceipt {
    call: ToolCall;
    output: string;
}

export interface ToolCallEvent {
    name: string;
    args: Record<string, unknown> | null;
}

export interface ToolResultEvent {
    name: string;
    args: Record<string, unknown> | null;
    output: string;
    durationMs: number;
    ok: boolean;
}

export interface ReplyOutcome {
    acts: MessageSegment[];
}

export interface HeldOutcome {
    held: ToolHold[];
}

export interface AbortedOutcome {
    aborted: true;
}

/** 主循环一轮的完整结果：发言 / 门禁挂起 / 被中断；模型或通道出错时退化为错误文本 */
export type AgentRunResult = ReplyOutcome | HeldOutcome | AbortedOutcome | string;

export interface WakeTrigger {
    type: string;
    id?: string;
    title?: string;
    prompt?: string;
}

export interface SessionUsageStats {
    requests: number;
    inputTokens: number;
    cachedTokens: number;
}

export default class Agent extends EventEmitter {
    /** 会话 ID（{from}:{id}），同时作为长期记忆的派生键 */
    readonly sessionId: string;
    readonly memory: ChatRecorder;
    readonly planBoard = new PlanBoard();
    private running = false;
    private aborted = false;
    private controller: AbortController | null = null;
    pendingTrigger: WakeTrigger | null = null;
    private extensionOverview: ExtensionOverviewEntry[] = [];
    private usageRequests = 0;
    private usageInputTokens = 0;
    private usageCachedTokens = 0;

    constructor(opts: { sessionId: string; memory: ChatRecorder }) {
        super();
        this.sessionId = opts.sessionId;
        this.memory = opts.memory;
    }



    async run(ctx: Context): Promise<void> {
        if (this.running) {
            logger.info("会话已有模型请求进行中，跳过本次请求:", this.sessionId);
            return;
        }
        this.running = true
        this.aborted = false
        this.controller = new AbortController()
        try {
            await reloadSkills();
            this.extensionOverview = await extensionRegistry.overview();

            const outcome = await this.runLoop(ctx);
            if (typeof outcome === "string") {
                this.deliver([{ type: "text", data: { text: `ERROR:${outcome}` } }]);
                return;
            }
            if (isAbortedOutcome(outcome)) return;
            // 门禁挂起：本轮不再产出回复，询问段交给分发方经适配器发出；挂起信息不进对话记忆
            if (isHeldOutcome(outcome)) {
                this.broadcast("approval", outcome.held);
                return;
            }
            this.deliver(outcome.acts);
        }
        finally {
            this.controller = null
            this.running = false
            void this.postRunMaintenance();
        }
    }


    /**
     * 立即中断当前会话的主循环
     * 通过 AbortController 直接打断在途的模型请求与工具执行（run_shell 会强杀子进程），
     * 主循环随即在检查点收尾
     * @returns 是否确有进行中的任务被中断
     */
    abort(): boolean {
        const controller = this.controller;
        if (!this.running || !controller || controller.signal.aborted) return false;
        this.aborted = true;
        controller.abort();
        logger.info("已中断本轮任务:", this.sessionId);
        return true;
    }


    private async postRunMaintenance(): Promise<void> {
        try {
            await runNotesMaintenance(this);
        }
        finally {
            this.memory.maybeSummarize();
        }
    }


    private async runLoop(ctx: Context): Promise<AgentRunResult> {
        const toolCtx: ToolContext = { ...ctx, agent: this, signal: this.controller?.signal };
        const replyTool = resolveReplyTool(ctx.adapter);
        if (!replyTool) return "当前通道没有可用的发言工具，本轮无法回复";
        /** 已执行的工具轮数 */
        let toolDepth = 0;
        /** 是否已因纯文本输出纠偏重试过（只重试一次，防循环） */
        let corrected = false;

        while (true) {
            if (this.aborted) return this.abortedOutcome();

            // 工作阈值守护：请求前守体积，工具痕迹累积超预算时折叠最旧的部分，避免长工具链把上下文撑爆
            this.memory.compactIfNeeded(config.contextBudgetTokens);
            const result = await this.ask(this.availableTools(replyTool));
            if (this.aborted) return this.abortedOutcome();
            if (typeof result === "string") return result;

            const calls = result.message.tool_calls ?? [];

            if (calls.length === 0) {
                const text = (result.message.content ?? "").trim();
                // 正文为空 = 模型选择本轮不发言：既无内容可纠偏，也没有可桥接的文本，直接收尾
                if (text === "") return { acts: [] };
                if (!corrected) {
                    corrected = true;
                    this.memory.add({ role: "system", content: { text: `你直接输出了文本而没有调用 send_message，文本不会被发送。请用 send_message 重新发送这段内容：「${text.slice(0, 200)}」` } });
                    logger.warn("模型以纯文本作答，已回填纠偏并重试:", this.sessionId);
                    continue;
                }
                logger.warn("纠偏后模型仍以纯文本作答，桥接发送:", this.sessionId);
                return { acts: [{ type: "text", data: { text } }] };
            }

            // 工具链达到上限 → 强制收敛：只留发言工具再问一次，逼模型直接作答
            if (toolDepth >= config.toolChainMaxLength) {
                return this.converge(replyTool, toolCtx);
            }
            toolDepth++;

            // 先把普通工具跑完（并行执行），有门禁挂起则立即中断本轮
            const replyCalls = pickReplyCalls(calls, replyTool);
            const otherCalls = calls.filter((call) => !replyCalls.includes(call));
            const receipts: ToolReceipt[] = [];
            if (otherCalls.length > 0) {
                const { holds, results } = await this.runTools(otherCalls, toolCtx);
                if (holds.length > 0) return { held: holds };
                receipts.push(...results);
            }

            let acts: MessageSegment[] | null = null;
            let spokenAccepted = false;
            if (replyCalls.length > 0) {
                const spoken = await this.speak(replyCalls, replyTool, toolCtx);
                receipts.push(...spoken.results);
                acts = spoken.acts.length > 0 ? spoken.acts : null;
                spokenAccepted = spoken.accepted;
            }

            for (const receipt of receipts) this.recordToolResult(receipt.call, receipt.output);
            if (this.aborted) return this.abortedOutcome();

            //  没有别的活了：发言就是本轮结论（含「明确不发言」），交给 run() 统一投递
            if (otherCalls.length === 0) {
                if (spokenAccepted) return { acts: acts ?? [] };
                continue;
            }

            // 还有别的活没干完：这一轮的话当场发出，然后接着跑，直到只剩发言或没有工具
            if (acts) {
                this.deliver(acts);
            }
        }
    }


    private async buildMessages(): Promise<ChatMessage[]> {
        const messages: ChatMessage[] = [];
        const systemPrompt = readSystemPrompt();
        if (systemPrompt !== "") messages.push({ role: "system", content: systemPrompt });

        messages.push({ role: "system", content: `技能列表：${JSON.stringify(skills)}` });

        if (this.extensionOverview.length > 0) {
            messages.push({
                role: "system",
                content: `扩展工具来源：${JSON.stringify(this.extensionOverview)}。`,
            });
        }
        // 全局笔记：AI 自我维护，位于对话历史概要之前
        const notes = await renderNotesBlock();
        if (notes) messages.push({ role: "system", content: notes });

        const midSummary = this.memory.getMidSummary();
        if (midSummary) {
            messages.push({ role: "system", content: `对话历史概要:${midSummary}` });
        }

        const tail: ChatMessage[] = [];
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
            tools,
            signal: this.controller?.signal,
        });
        if (typeof result === "string") return result || "AI 服务无响应";
        if (result.usage) {
            this.usageRequests += 1;
            this.usageInputTokens += result.usage.inputTokens;
            this.usageCachedTokens += result.usage.cachedTokens;
        }
        return result;
    }


    private availableTools(replyTool: ReplyTool): ToolDefinition[] {
        return [replyTool.definition, ...getAllTools()];
    }

    /**
     * 工具链达到上限后的收敛请求：只留发言工具再问一次，逼模型直接作答
     * 收敛请求失败或模型仍不说话时，本轮不发言
     */
    private async converge(replyTool: ReplyTool, toolCtx: ToolContext): Promise<ReplyOutcome | AbortedOutcome> {
        if (this.aborted) return this.abortedOutcome();
        const final = await this.ask([replyTool.definition]);
        if (this.aborted) return this.abortedOutcome();
        if (typeof final === "string") {
            logger.warn("收敛请求失败，本轮不发言:", final);
            return { acts: [] };
        }
        const replyCalls = pickReplyCalls(final.message.tool_calls ?? [], replyTool);
        if (replyCalls.length > 0) {
            // 收敛轮直接收尾，不再请求模型，回执无需写回
            const { acts, accepted } = await this.speak(replyCalls, replyTool, toolCtx);
            if (accepted) return { acts };
        }
        // 收敛轮没有纠偏预算：正文若已含答复文本，直接桥接成发言
        const text = (final.message.content ?? "").trim();
        if (text !== "") {
            logger.warn("收敛请求得到纯文本，桥接发送:", this.sessionId);
            return { acts: [{ type: "text", data: { text } }] };
        }
        logger.info("收敛后模型仍未发言:", this.sessionId);
        return { acts: [] };
    }



    private abortedOutcome(): AbortedOutcome {
        logger.info("本轮任务已被中断:", this.sessionId);
        this.memory.add({ role: "system", content: { text: "本轮任务被用户中断，未完成的部分不要自动继续，除非用户明确要求" } });
        return { aborted: true };
    }


    /**
     * 执行发言工具调用：按调用顺序规范化消息段
     * 规范化失败的原因随回执回填给模型自修
     * @returns 本轮消息段（空数组 = 模型明确本轮不发言）、是否至少受理了一个调用（决定是否收尾）与各调用的结果回执
     */
    private async speak(calls: ToolCall[], replyTool: ReplyTool, toolCtx: ToolContext): Promise<{ acts: MessageSegment[]; accepted: boolean; results: ToolReceipt[] }> {
        const acts: MessageSegment[] = [];
        const results: ToolReceipt[] = [];
        let accepted = false;
        /** 本轮已成功受理的发言参数：端点偶发重复下发同一 tool_call 时，避免同一句话发两遍 */
        const acceptedArgs = new Set<string>();
        for (const call of calls) {
            if (acceptedArgs.has(call.function.arguments)) {
                results.push({ call, output: "与本轮已发送的发言调用完全相同，已忽略，消息只发一次" });
                continue;
            }
            const output = await runReplyCall(replyTool, call, toolCtx);
            if (typeof output === "string") {
                results.push({ call, output });
                continue;
            }
            acceptedArgs.add(call.function.arguments);
            accepted = true;
            acts.push(...output.acts);
            results.push({ call, output: output.acts.length > 0 ? "消息已发送" : "已确认本轮不发言" });
        }
        return { acts: accepted ? acts : [], accepted, results };
    }


    private async runTools(toolCalls: ToolCall[], toolCtx: ToolContext): Promise<{ holds: ToolHold[]; results: ToolReceipt[] }> {
        const executions = await Promise.all(toolCalls.map((toolCall) => this.runTool(toolCall, toolCtx)));
        const holds: ToolHold[] = [];
        const results: ToolReceipt[] = [];
        for (const { toolCall, args, output, durationMs, ok } of executions) {
            // 挂起调用既不记录也不广播：模型不该知道它悬而未决，确认后的结果由确认链注入上下文
            if (isToolHold(output)) {
                holds.push(output);
                continue;
            }
            results.push({ call: toolCall, output });
            this.broadcast("tool-result", { name: toolCall.function.name, args, output, durationMs, ok });
        }
        return { holds, results };
    }


    private async runTool(toolCall: ToolCall, toolCtx: ToolContext): Promise<ToolExecution> {
        const name = toolCall.function.name;
        let args: Record<string, unknown> | null = null;
        const startedAt = Date.now();
        try {
            args = JSON.parse(toolCall.function.arguments);
            this.broadcast("tool-call", { name, args });
            const output = await callTool(toolCall, toolCtx);
            return { toolCall, args, output, durationMs: Date.now() - startedAt, ok: true };
        }
        catch (err) {
            logger.error("AI 工具调用失败:", name, err);
            return { toolCall, args, output: `工具 ${name} 执行失败：${errorMessage(err)}`, durationMs: Date.now() - startedAt, ok: false };
        }
    }

    get isRunning(): boolean {
        return this.running;
    }

    get usageStats(): SessionUsageStats {
        return { requests: this.usageRequests, inputTokens: this.usageInputTokens, cachedTokens: this.usageCachedTokens };
    }



    recordToolResult(call: ToolCall, output: string): void {
        this.memory.add({ role: "assistant", content: null, tool_calls: [{ id: call.id, type: "function", function: call.function }] });
        this.memory.add({ role: "tool", tool_call_id: call.id, content: output });
        logger.info("调用工具:", call.function.name, " 参数：", call.function.arguments, " 结果：", output);
    }


    recordToolDenial(call: ToolCall, byName: string): void {
        const who = byName.trim() || "管理员";
        this.recordToolResult(call, `工具 ${call.function.name} 的调用被${who}拒绝执行，操作未运行。不要重复发起同一操作，除非用户明确要求。`);
        logger.info("工具调用被拒绝:", call.function.name, " 参数：", call.function.arguments);
    }


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
    private deliver(acts: MessageSegment[]): void {
        if (acts.length === 0) {
            logger.info("本轮选择不发言:", this.sessionId);
            this.memory.add({ role: "assistant", content: { action: [], note: "本轮选择不发言" } });
            return;
        }
        const payload: ReplyOutcome = { acts };
        this.broadcast("reply", payload);
        this.memory.add({ role: "assistant", content: { action: acts } });
        this.memory.msgWithoutChat = 0;
    }
}



function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
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
function isHeldOutcome(value: AgentRunResult): value is HeldOutcome {
    return typeof value !== "string" && Array.isArray((value as HeldOutcome).held);
}

/** 守卫：主循环是否因用户中断而收尾 */
function isAbortedOutcome(value: unknown): value is AbortedOutcome {
    return typeof value === "object" && value !== null && (value as { aborted?: unknown }).aborted === true;
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
