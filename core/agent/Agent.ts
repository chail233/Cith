import { EventEmitter } from "node:events";
import { callLLM } from "./client.ts";
import type { LlmMessage } from "./client.ts";
import { callTool, getAllTools } from "./tools.js";
import { reloadSkills } from "./skill.js";
import { buildMessages, renderPlan } from "./contextBuilder.ts";
import { parseReplyResult } from "./replyParser.ts";
import config from "../config.js";
import logger from "../utils/logger.js";
import type { ChatRecorder } from "./recorder.js";
import type { Context, MessageSegment } from "../types/index.ts";
import type { AgentRunOutcome, LlmResult, Plan, PlanStatus, RawTodo, ReplyPayload, ToolCall, ToolExecution } from "./types.ts";

/** 传给工具层的上下文：管道上下文 + 发起本次调用的 Agent（工具据此访问记忆与会话 ID） */
export type AgentToolContext = Context & { agent: Agent };

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

    private plan: Plan | null = null;

    /** 定时苏醒注入的唤醒说明；buildMessages 读取后置空，避免污染后续对话 */
    pendingTrigger: { type: string; id?: string; title?: string; prompt?: string } | null = null;

    constructor(opts: { sessionId: string; memory: ChatRecorder }) {
        super();
        this.sessionId = opts.sessionId;
        this.memory = opts.memory;
    }

    /**
     * 覆盖写入本会话的计划（全量替换）；空步骤数组或非法输入视为清空
     */
    setPlan(goal: unknown, todos: RawTodo[] | null | undefined): void {
        if (!Array.isArray(todos) || todos.length === 0) {
            this.plan = null;
            return;
        }
        this.plan = { goal: normalizeGoal(goal), items: todos.map(normalizeTodo) };
    }


    /**
     * 获取未完成（存在 pending/in_progress 条目）的计划
     */
    getActivePlan(): Plan | null {
        if (!this.plan) return null;
        const finished = this.plan.items.every((t) => t.status === "done" || t.status === "cancelled");
        return finished ? null : this.plan;
    }

    /** 渲染本会话计划为文本（目标行 + 步骤清单）；无计划时返回 null */
    renderPlan(): string | null {
        return this.plan ? renderPlan(this.plan) : null;
    }

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
     * @returns 成功时为本轮产出；请求失败时为错误文本
     */
    private async runLoop(ctx: Context): Promise<AgentRunOutcome | string> {
        const toolCtx: AgentToolContext = { ...ctx, agent: this };
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
            const result = await this.ask(hint);
            hint = [];
            if (typeof result === "string") return result;
            tokens += result.totalTokens;

            // 1. 无工具调用 → 最终回复；解析失败时追加一句格式提示重试一次
            if (!result.message.tool_calls) {
                const parsed = parseReplyResult(result.message.content);
                if (parsed.ok || formatRetried) return { acts: parsed.segments, tokens };
                formatRetried = true;
                hint = [FORMAT_RETRY_HINT];
                logger.warn("AI 回复格式无法解析，已追加重试一次");
                continue;
            }

            // 2. 工具链达到上限 → 强制收敛：不带工具再问一次，逼模型直接作答，避免空回复把整轮吞掉
            if (toolDepth >= config.toolChainMaxLength) {
                return this.converge(result, tokens);
            }

            // 3. 执行工具：并行调用，按原顺序回填痕迹
            toolDepth++;
            await this.runTools(result.message.tool_calls, toolCtx);
        }
    }

    /**
     * 请求一次模型
     * @param hint 尾部临时追加的消息（如格式纠错提示），不写入会话历史
     * @param withTools 是否携带工具定义；收敛请求传 false
     * @returns 成功返回模型结果，失败返回错误文本（调用方只需判断 string）
     */
    private async ask(hint: LlmMessage[], withTools = true): Promise<LlmResult | string> {
        const result = await callLLM({
            model: config.chatModel,
            messages: [...buildMessages(this), ...hint],
            temperature: 0.2,
            ...(withTools ? { tools: getAllTools() } : {}),
        });
        return result || "AI 服务无响应";
    }

    /**
     * 工具链达到上限后的收敛请求：不带工具再问一次，逼模型直接作答
     * 收敛请求本身失败时，退回用最后一次带工具的回复内容
     */
    private async converge(fallback: LlmResult, tokens: number): Promise<AgentRunOutcome> {
        const final = await this.ask([], false);
        if (typeof final === "string") {
            logger.warn("收敛请求失败，退回最后一次回复:", final);
            return { acts: parseReplyResult(fallback.message.content).segments, tokens };
        }
        return { acts: parseReplyResult(final.message.content).segments, tokens: tokens + final.totalTokens };
    }

    /**
     * 执行同一轮的多个工具调用：并行执行，并按 tool_calls 原顺序回填痕迹、广播结果
     */
    private async runTools(toolCalls: ToolCall[], toolCtx: AgentToolContext): Promise<void> {
        const executions = await Promise.all(toolCalls.map((toolCall) => this.runTool(toolCall, toolCtx)));
        for (const { toolCall, name, args, output } of executions) {
            this.recordToolCall(name, JSON.stringify(args ?? toolCall.function.arguments), output);
            this.broadcast("tool-result", { name, args, result: output });
        }
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

/** 统一提取异常信息文本 */
function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** 判断任意值是否为合法状态（类型守卫，替代断言） */
function isPlanStatus(value: unknown): value is PlanStatus {
    return typeof value === "string" && value in STATUS_KEYS;
}

const STATUS_KEYS: Record<PlanStatus, true> = { pending: true, in_progress: true, done: true, cancelled: true };

/** 归一化单条原始输入：状态非法回落 pending，内容截断防止上下文膨胀 */
function normalizeTodo(raw: RawTodo): Plan["items"][number] {
    return {
        content: String(raw?.content ?? "").slice(0, 200),
        status: isPlanStatus(raw?.status) ? raw.status : "pending",
    };
}

/** 归一化目标：截断防止上下文膨胀 */
function normalizeGoal(raw: unknown): string {
    return String(raw ?? "").slice(0, 200);
}
