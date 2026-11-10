import { EventEmitter } from "node:events";
import { callLLM } from "./client.ts";
import type { LlmMessage } from "./client.ts";
import { callTool, getAllTools } from "./tools.js";
import { reloadSkills } from "./skill.js";
import { buildMessages } from "./contextBuilder.ts";
import { parseReplyResult } from "./replyParser.ts";
import { PlanBoard } from "./plan.ts";
import config from "../config.js";
import logger from "../utils/logger.js";
import type { ChatRecorder } from "./recorder.js";
import type { Context, MessageSegment } from "../types/index.ts";
import type { AgentRunOutcome, AgentToolContext, HeldOutcome, LlmResult, ReplyPayload, ToolCall, ToolContext, ToolDefinition, ToolExecution, ToolHold } from "./types.ts";
import type { ReplyTool, ReplyToolResult } from "../bot/adapters/reply-tool.ts";

/**
 * 输出无法解析时追加给模型的格式纠正提示
 * 只作为紧接着那一次请求的尾部临时消息，不写入会话历史
 */
const FORMAT_RETRY_HINT: LlmMessage = {
    role: "system",
    content: "上一条回复无法解析。请重新输出：只输出一个 JSON 对象，形如 "
        + '{"action":[{"type":"text","data":{"text":"..."}}]}，'
        + "不要包含 markdown 代码块、注释或任何解释文字。",
};

export default class Agent extends EventEmitter {
    /** 会话 ID（{from}:{id}），同时作为长期记忆的派生键 */
    readonly sessionId: string;
    /** 本会话的三层记忆记录器 */
    readonly memory: ChatRecorder;
    /** 本会话的任务计划 */
    readonly planBoard = new PlanBoard();

    /** 定时苏醒注入的唤醒说明；buildMessages 读取后置空，避免污染后续对话 */
    pendingTrigger: { type: string; id?: string; title?: string; prompt?: string } | null = null;

    constructor(opts: { sessionId: string; memory: ChatRecorder }) {
        super();
        this.sessionId = opts.sessionId;
        this.memory = opts.memory;
    }

    // ---------------------------------------------------------------- 对外产出

    /**
     * 向用户播报一句进展说明
     * @param text 播报内容
     * @returns 是否真正发出；内容为空或与上次播报重复时返回 false
     */
    narrate(text: string): boolean {
        const content = text.trim();
        if (!content) return false;
        this.deliver([{ type: "text", data: { text: content } }], 0);
        return true;
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
            // 聊天阈值守护：整轮跑完后若上下文仍超阈值，后台静默摘要，不阻塞监听器摘除与后续对话
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
        /** 本轮累计消耗 */
        let tokens = 0;
        /** 已执行的工具轮数 */
        let toolDepth = 0;
        /** 尾部临时追加的纠错提示，只作用于紧接着的一次请求 */
        let hint: LlmMessage[] = [];
        /** 格式纠错整轮只给一次机会，避免反复无效重试 */
        let formatRetried = false;

        while (true) {
            // 工作阈值守护：请求前守体积，工具痕迹累积超预算时折叠最旧的部分，避免长工具链把上下文撑爆
            this.memory.compactIfNeeded(config.contextBudgetTokens);
            const result = await this.ask(hint, this.availableTools(replyTool));
            hint = [];
            if (typeof result === "string") return result;
            tokens += result.totalTokens;

            const calls = result.message.tool_calls ?? [];

            // 1. 没有任何工具调用 → 旧文本通道（裸 JSON）；解析失败时追加一句格式提示重试一次
            if (calls.length === 0) {
                const parsed = parseReplyResult(result.message.content);
                if (parsed.ok || formatRetried) return { acts: parsed.segments, tokens };
                formatRetried = true;
                hint = [FORMAT_RETRY_HINT];
                logger.warn("AI 回复格式无法解析，已追加重试一次");
                continue;
            }

            // 2. 工具链达到上限 → 强制收敛：只留发言工具再问一次，逼模型直接作答
            if (toolDepth >= config.toolChainMaxLength) {
                return this.converge(result, tokens, replyTool, toolCtx);
            }

            toolDepth++;

            // 3. 先把普通工具跑完（并行执行），有门禁挂起则立即中断本轮
            const replyCalls = pickReplyCalls(calls, replyTool);
            const otherCalls = replyCalls.length > 0 ? calls.filter((call) => !replyCalls.includes(call)) : calls;
            if (otherCalls.length > 0) {
                const holds = await this.runTools(otherCalls, toolCtx);
                if (holds.length > 0) return { held: holds };
            }

            // 4. 发言：参数合法就本轮结束（不回填工具结果）；全部不合法则把错误回填给模型自修
            if (replyTool && replyCalls.length > 0) {
                const acts = await this.speak(replyCalls, replyTool, toolCtx);
                if (acts.length > 0) return { acts, tokens };
            }
        }
    }

    /**
     * 请求一次模型
     * @param hint 尾部临时追加的消息（如格式纠错提示），不写入会话历史
     * @param tools 本轮可用的工具定义；空数组表示不带工具请求
     * @returns 成功返回模型结果，失败返回错误文本（调用方只需判断 string）
     */
    private async ask(hint: LlmMessage[], tools: ToolDefinition[]): Promise<LlmResult | string> {
        const result = await callLLM({
            model: config.chatModel,
            messages: [...buildMessages(this), ...hint],
            temperature: 0.2,
            ...(tools.length > 0 && { tools }),
        });
        return result || "AI 服务无响应";
    }

    /**
     * 本轮工具表：发言工具排首位（随通道固定，利于前缀缓存），其后是本地工具与已激活 MCP 工具
     */
    private availableTools(replyTool: ReplyTool | null): ToolDefinition[] {
        const tools = getAllTools();
        return replyTool ? [replyTool.definition, ...tools] : tools;
    }

    /**
     * 工具链达到上限后的收敛请求：只留发言工具再问一次，逼模型直接作答
     * 收敛请求本身失败时，退回用最后一次带工具的回复内容
     */
    private async converge(fallback: LlmResult, tokens: number, replyTool: ReplyTool | null, toolCtx: AgentToolContext): Promise<AgentRunOutcome> {
        const final = await this.ask([], replyTool ? [replyTool.definition] : []);
        if (typeof final === "string") {
            logger.warn("收敛请求失败，退回最后一次回复:", final);
            return { acts: parseReplyResult(fallback.message.content).segments, tokens };
        }
        const totalTokens = tokens + final.totalTokens;
        const replyCalls = pickReplyCalls(final.message.tool_calls ?? [], replyTool);
        if (replyTool && replyCalls.length > 0) {
            const acts = await this.speak(replyCalls, replyTool, toolCtx);
            if (acts.length > 0) return { acts, tokens: totalTokens };
        }
        return { acts: parseReplyResult(final.message.content).segments, tokens: totalTokens };
    }

    // ---------------------------------------------------------------- 工具执行

    /**
     * 执行发言工具调用：按调用顺序规范化消息段
     * 成功的发言不写工具痕迹，否则模型下一轮会看到自己说过的话再重复一遍；
     * 规范化失败则把原因回填给模型自修
     * @returns 待发送消息段；空数组表示本轮没有可发内容（错误已回填）
     */
    private async speak(calls: ToolCall[], replyTool: ReplyTool, toolCtx: AgentToolContext): Promise<MessageSegment[]> {
        const acts: MessageSegment[] = [];
        for (const call of calls) {
            const output = await runReplyCall(replyTool, call, toolCtx);
            if (typeof output === "string") {
                this.recordToolCall(call.function.name, call.function.arguments, output);
                continue;
            }
            acts.push(...output.acts);
        }
        return acts;
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
     */
    private deliver(acts: MessageSegment[], tokens: number): void {
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

/** 守卫：工具调用结果是否为门禁挂起 */
function isToolHold(value: unknown): value is ToolHold {
    return typeof value === "object" && value !== null && (value as { held?: unknown }).held === true;
}

/** 守卫：主循环是否因门禁挂起而中止 */
function isHeldOutcome(value: AgentRunOutcome | HeldOutcome): value is HeldOutcome {
    return Array.isArray((value as HeldOutcome).held);
}

/** 从适配器取发言工具；没有适配器（如测试替身）时返回 null，退回旧文本通道 */
function resolveReplyTool(adapter: Context["adapter"] | undefined): ReplyTool | null {
    if (!adapter) return null;
    try {
        return adapter.replyTool();
    }
    catch (err) {
        logger.error("适配器生成发言工具失败，本轮退回文本通道:", err);
        return null;
    }
}

/** 挑出本轮工具调用里哪些是发言调用 */
function pickReplyCalls(calls: ToolCall[], replyTool: ReplyTool | null): ToolCall[] {
    if (!replyTool) return [];
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
