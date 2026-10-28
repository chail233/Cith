/**
 * Agent：AI 处理核心
 * 封装"LLM 请求 → 工具调用 → 回填上下文 → 再请求"的完整 Agent 循环，
 *
 * 事件：
 *   - "reply"       {acts, tokens}  本轮解析出的回复动作（含工具链中间回复）
 *   - "tool-call"   {name, args}    即将执行的工具调用（工具门禁通知等展示用途）
 *   - "tool-result" {name, args, result} 工具执行完成的结果
 */
import { EventEmitter } from "node:events";
import { callLLM } from "./client.ts";
import { callTool, getAllTools } from "./tools.js";
import { reloadSkills } from "./skill.js";
import { buildMessages, renderPlan } from "./contextBuilder.ts";
import { parseReply } from "./replyParser.ts";
import config from "../config.js";
import logger from "../utils/logger.js";
import type { ChatRecorder } from "./recorder.js";
import type { Context } from "../types/index.ts";
import type { LlmResult, Plan, PlanStatus, RawTodo, ReplyAct, ReplyPayload } from "./types.ts";

/** 传给工具层的上下文：管道上下文 + 发起本次调用的 Agent（工具据此访问记忆与会话 ID） */
export type AgentToolContext = Context & { agent: Agent };

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

    /** 获取本会话的计划，不存在时返回 null */
    getPlan(): Plan | null {
        return this.plan;
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

    async run(ctx: Context): Promise<void> {
        if (!this.memory.tryBeginRequest()) {
            logger.info("会话已有模型请求进行中，跳过本次请求:", this.sessionId);
            return;
        }
        try {
            // 触发中期记忆概括（如需）
            await this.memory.summarizeCache();
            // 每回合现取：开工前重新扫描 skills 目录，保证强加载/技能列表与磁盘一致
            await reloadSkills();

            const request = () => callLLM({
                model: config.CHAT_MODEL,
                messages: buildMessages(this),
                temperature: 0.2,
                responseFormat: { type: "json_object" },
                tools: getAllTools(),
            });

            const toolCtx: AgentToolContext = { ...ctx, agent: this };

            let result: LlmResult | string;
            let tokenCount = 0;
            let toolDepth = 0;
            while (true) {
                result = await request();
                if (!result || typeof result === "string") {
                    this.deliver([{ cmd: "text", content: typeof result === "string" ? "ERROR:" + result : "ERROR:AI 服务无响应" }], 0);
                    return;
                }
                tokenCount += result.totalTokens;
                // 无工具调用 → 最终回复；工具链达到长度上限 → 强制收敛（与原循环轮数一致）
                if (!result.message.tool_calls || toolDepth > config.TOOLCHAIN_MAX_LENGTH) break;
                toolDepth++;

                const interim = parseReply(result.message.content);
                if (interim.length > 0) {
                    this.deliver(interim, tokenCount);
                    tokenCount = 0;
                }
                // 同一轮多个工具调用并行执行；失败不抛断流程，错误原因回写为 tool 消息供模型自我修正
                const toolResults = await Promise.all(
                    result.message.tool_calls.map(async (toolCall) => {
                        const name = toolCall.function.name;
                        let args: Record<string, unknown> | null = null;
                        let output = "";
                        try {
                            args = JSON.parse(toolCall.function.arguments);
                            this.broadcast("tool-call", { name, args });
                            output = await callTool(toolCall, toolCtx);
                        }
                        catch (err) {
                            logger.error("AI 工具调用失败:", name, err);
                            output = `工具 ${name} 执行失败：${errorMessage(err)}`;
                        }
                        return { toolCall, name, args, output };
                    }),
                );
                // 按 tool_calls 原顺序将调用过程与结果回填为文本痕迹（system 消息）
                for (const { toolCall, name, args, output } of toolResults) {
                    this.recordToolCall(name, JSON.stringify(args ?? toolCall.function.arguments), output);
                    this.broadcast("tool-result", { name, args, result: output });
                }
            }

            this.deliver(parseReply(result.message.content), tokenCount);
        }
        finally {
            this.memory.endRequest();
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
     * 产出一轮回复：广播 "reply" 事件供分发方消费，
     */
    private deliver(acts: ReplyAct[], tokens: number): void {
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
