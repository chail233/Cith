import { makeMemoryUserId, searchMemory } from "../long-term-memory.js";
import logger from "../../utils/logger.js";
import type { ToolContext, ToolDefinition, ToolModule } from "../types.ts";

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "get_memory",
        description: "根据当前对话内容搜索相关记忆",
        parameters: {},
    },
};

/**
 * 搜索长期记忆（使用当前会话的短期上下文作为查询线索）
 * 会话上下文由调用方 Agent 通过 ctx.agent 注入
 */
export async function execute(_param: unknown, ctx?: ToolContext): Promise<string> {
    const agent = ctx?.agent;
    if (!agent) return "无法确定当前会话，无法搜索记忆";
    const chatRecorder = agent.memory;
    const shortTermMessages = chatRecorder.getAll();
    if (shortTermMessages.length > 0) {
        const userId = makeMemoryUserId(agent.sessionId);

        const userMessages = shortTermMessages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .slice(-10);

        if (userMessages.length === 0) return "没有有效对话记录";

        const recalled = await searchMemory(userId, userMessages);
        logger.debug("长期记忆搜索结果:", recalled);
        return recalled.join("\n---\n") || "没有找到相关记忆";
    }
    return "没有对话记录，无法搜索记忆";
}

export default { definition, execute } satisfies ToolModule;
