import { listAgents, readAgentMessages } from "../AgentManager.ts";
import type { ToolContext, ToolDefinition, ToolModule } from "../types.ts";

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "get_session_context",
        description:
            "跨会话查看其它活跃会话的近期对话原文。" +
            "不传 session 时列出当前所有活跃会话（空间标识 + 对话条数 + 空闲时长）；" +
            "传入 session 时读取该会话尾部最近 count 条对话记录，每行一条 JSON：" +
            "role 为 user 时 content.message 是消息段数组（含 name / time），role 为 assistant 时 content.action 是我发出的消息段。" +
            "会话回收后原文不再保留，更早的沉淀内容请用 get_memory 检索",
        parameters: {
            type: "object",
            properties: {
                session: {
                    type: "string",
                    description: "目标会话 ID，形如 group:123456 / user:654321，来自列表结果",
                },
                count: {
                    type: "number",
                    description: "读取尾部对话记录的条数（按需要自行决定），缺省 20，上限 200",
                },
            },
            required: [],
        },
    },
};

/** get_session_context 入参：模型生成的 JSON 字段类型不可信，需归一化 */
type RawParams = { session?: unknown; count?: unknown };

/** 消息条数上限：防止一次调用把调用方上下文撑爆 */
const MAX_COUNT = 200;

/**
 * 跨会话上下文工具
 * - 无 session：列出活跃会话池里的所有会话
 * - 有 session：读取目标会话尾部的对话记录（只含 user 与 assistant）
 *
 * 记录原样透传（每行一条 JSON），消息段结构由记忆系统定义，与工具解耦
 */
export async function execute(param: unknown, ctx?: ToolContext): Promise<string> {
    const { session, count } = (param ?? {}) as RawParams;
    const currentId = ctx?.agent?.sessionId ?? "";

    if (typeof session !== "string" || session === "") {
        const infos = listAgents();
        if (infos.length === 0) return "当前没有活跃会话";
        return infos
            .map((info) => {
                const current = info.id === currentId ? "，当前会话" : "";
                return `- ${info.id}（${info.short} 条，空闲 ${info.idleMin} 分钟${current}）`;
            })
            .join("\n");
    }

    const raw = Number(count);
    const limit = Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), MAX_COUNT) : 20;
    const records = readAgentMessages(session, limit);
    if (!records) return `会话 ${session} 不在活跃会话池中（可能已回收，沉淀内容可用 get_memory 检索）`;
    if (records.length === 0) return `会话 ${session} 暂无可读的对话消息`;
    return records.map((msg) => JSON.stringify(msg)).join("\n");
}

export default { definition, execute } satisfies ToolModule;
