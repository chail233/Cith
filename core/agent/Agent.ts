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
import { callLLM } from "./client.js";
import { callTool, getAllTools } from "./tools.js";
import { reloadSkills } from "./skill.js";
import { buildMessages } from "./contextBuilder.ts";
import { parseReply } from "./replyParser.ts";
import config from "../config.js";
import logger from "../utils/logger.js";
import type { ChatRecorder } from "./recorder.js";
import type { Context, ReplyAct, ReplyPayload, ToolCall } from "../types/index.ts";

/** 传给工具层的上下文：管道上下文 + 发起本次调用的 Agent（工具据此访问记忆与会话 ID） */
export type AgentToolContext = Context & { agent: Agent };

export default class Agent extends EventEmitter {
    /** 会话 ID（{from}:{id}），同时作为长期记忆与计划的派生键 */
    readonly sessionId: string;
    /** 本会话的三层记忆记录器 */
    readonly memory: ChatRecorder;

    constructor(opts: { sessionId: string; memory: ChatRecorder }) {
        super();
        this.sessionId = opts.sessionId;
        this.memory = opts.memory;
    }

    /**
     * 运行一次 Agent 循环：基于当前记忆发起 LLM 请求，
     * 处理工具链直至产出最终回复；产出的回复经 "reply" 事件广播并写入记忆。
     * 同一会话已有请求进行中时直接返回（沿用会话级并发守卫）。
     */
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
                messages: buildMessages(this.memory),
                temperature: 0.2,
                enableSearch: true,
                responseFormat: { type: "json_object" },
                tools: getAllTools(),
            });

            let result = await request();
            if (!result || typeof result === "string") {
                this.deliver([{ cmd: "text", content: typeof result === "string" ? "ERROR:" + result : "ERROR:AI 服务无响应" }], 0);
                return;
            }

            let tokenCount = result.totalTokens;
            let toolDepth = 0;
            const toolCtx: AgentToolContext = { ...ctx, agent: this };
            while (result.message.tool_calls && toolDepth <= config.TOOLCHAIN_MAX_LENGTH) {
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
                // 按 tool_calls 原顺序回填上下文，保证 tool 消息与调用一一配对
                for (const { toolCall, name, args, output } of toolResults) {
                    this.recordToolCall(toolCall, name, JSON.stringify(args ?? toolCall.function.arguments), output);
                    this.broadcast("tool-result", { name, args, result: output });
                }

                result = await request();
                if (typeof result === "string") {
                    this.deliver([{ cmd: "text", content: "ERROR:" + result }], 0);
                    return;
                }
                tokenCount += result.totalTokens;
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
    recordToolCall(toolCall: ToolCall, toolName: string, argsText: string, result: string): void {
        this.memory.add({ role: "system", content: { text: `调用了工具 ${toolName}，参数：${argsText}` } });
        this.memory.add({ role: "tool", content: { text: result }, tool_call_id: toolCall.id });
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
