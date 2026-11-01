import type { ToolContext, ToolDefinition, ToolModule } from "../types.ts";

/** report_progress 工具入参 */
export interface ReportProgressParams {
    content?: unknown;
}

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "report_progress",
        description:
            "在长任务中，向用户简短播报当前正在做什么、进展到哪一步，避免长时间静默让人以为你卡住了。" +
            "只用于过程说明，不要用它发送最终结论，也不要代替正常回复；" +
            "同一句话不要反复说，有实质进展时再说。",
        parameters: {
            type: "object",
            properties: {
                content: {
                    type: "string",
                    description: "给用户看的一句话进展说明",
                },
            },
            required: ["content"],
        },
    },
};

/**
 * 把一句进展说明交给当前会话播报：走与正常回复相同的事件链，
 */
export async function execute(param: ReportProgressParams, ctx?: ToolContext): Promise<string> {
    const agent = ctx?.agent;
    if (!agent) return "无法确定当前会话，进展未播报";

    const content = typeof param?.content === "string" ? param.content.trim().slice(0, 100) : "";
    if (!content) return "缺少参数 content（要发给用户的一句话说明）";

    return agent.narrate(content)
        ? `已向用户播报：${content}`
        : "这句话刚播报过，本次未重复发送；可以继续执行，或换一种说法说明新的进展";
}

export default { definition, execute } satisfies ToolModule<ReportProgressParams>;
