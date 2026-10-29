import { makeMemoryUserId, normalizeQueries, searchMemory } from "../long-term-memory.js";
import { getMemoryStore } from "../../services/memory-store.ts";
import logger from "../../utils/logger.js";
import type { ToolContext, ToolDefinition, ToolModule } from "../types.ts";

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "get_memory",
        description:
            "检索长期记忆。传入 queries 时按每条语句分别检索；" +
            "不传或传空数组时，自动用当前会话最近 5 条消息逐条检索",
        parameters: {
            type: "object",
            properties: {
                queries: {
                    type: "array",
                    items: { type: "string" },
                    description:
                        "要检索的语句，一条一个（最多 5 条）。" +
                        "每条形如「群友 A 喜欢的游戏」这种独立短句；不传或空数组则用最近对话自动检索",
                },
            },
            required: [],
        },
    },
};

/** get_memory 入参：模型生成的 JSON 字段类型不可信，需归一化 */
type RawMemoryQuery = { queries?: unknown } | null | undefined;

/**
 * 搜索长期记忆
 * - 传入 queries：按每条语句各召回一次，合并去重后按相似度取前 topK
 * - 未传 queries（或空数组）：取最近 20 条消息里的有效文本，最多 5 条逐条检索
 */
export async function execute(param: unknown, ctx?: ToolContext): Promise<string> {
    const agent = ctx?.agent;
    if (!agent) return "无法确定当前会话，无法搜索记忆";
    if (!getMemoryStore()) return "长期记忆未启用或初始化失败，暂时无法检索";

    const userId = makeMemoryUserId(agent.sessionId);
    const queries = normalizeQueries((param as RawMemoryQuery)?.queries);

    let recalled: string[];
    if (queries.length > 0) {
        recalled = await searchMemory(userId, [], { queries });
        logger.debug(`长期记忆按 ${queries.length} 条语句检索:`, queries, recalled);
    }
    else {
        const shortTermMessages = agent.memory.getAll();
        if (shortTermMessages.length === 0) return "没有对话记录，无法搜索记忆";

        const userMessages = shortTermMessages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .slice(-20);

        if (userMessages.length === 0) return "没有有效对话记录";

        recalled = await searchMemory(userId, userMessages);
        logger.debug("长期记忆搜索结果:", recalled);
    }

    if (recalled.length === 0) return "没有找到相关记忆";
    return recalled.map((text) => `- ${text}`).join("\n");
}

export default { definition, execute } satisfies ToolModule;
