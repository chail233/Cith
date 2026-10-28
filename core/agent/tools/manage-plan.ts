import type { ToolContext, ToolDefinition, ToolModule, RawTodo } from "../types.ts";

/** manage_plan 工具入参（模型生成的 JSON，字段由 setPlan 归一化） */
export interface ManagePlanParams {
    goal?: string;
    todos?: RawTodo[];
}

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "manage_plan",
        description: "创建或更新当前任务计划。每次提交总体目标与完整任务清单覆盖旧计划；空数组表示任务结束并清空计划",
        parameters: {
            type: "object",
            properties: {
                goal: {
                    type: "string",
                    description: "本计划要达成的总体目标，一句话",
                },
                todos: {
                    type: "array",
                    description: "完整任务清单，按执行顺序排列",
                    items: {
                        type: "object",
                        properties: {
                            content: {
                                type: "string",
                                description: "步骤描述，简短",
                            },
                            status: {
                                type: "string",
                                enum: ["pending", "in_progress", "done", "cancelled"],
                                description: "步骤状态，同一时间最多一个 in_progress",
                            },
                        },
                        required: ["content", "status"],
                    },
                },
            },
            required: ["goal", "todos"],
        },
    },
};

/**
 * 创建/更新当前会话的任务计划（目标 + 步骤清单全量覆盖，空数组清空）
 */
export async function execute(param: ManagePlanParams, ctx?: ToolContext): Promise<string> {
    const agent = ctx?.agent;
    if (!agent) return "无法确定当前会话，计划未保存";
    const todos = param?.todos;
    if (!Array.isArray(todos)) return "缺少参数 todos（完整任务清单数组）";
    agent.setPlan(param?.goal, todos);
    const text = agent.renderPlan();
    if (!text) return "计划已清空";
    return `当前计划：\n${text}`;
}

export default { definition, execute } satisfies ToolModule<ManagePlanParams>;
