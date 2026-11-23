import type { ToolModule } from "../types.ts";

export const FINISH_TURN_TOOL_NAME = "finish_turn";

const finishTurnTool: ToolModule = {
    definition: {
        type: "function",
        function: {
            name: FINISH_TURN_TOOL_NAME,
            description: "结束当前 Agent 循环，无需参数，可以和其他工具组合调用，务必在任务结束时调用，",
            parameters: { type: "object", properties: {}, additionalProperties: false },
        },
    },
    async execute() {
        return "已请求在当前工具批次处理完毕后结束循环";
    },
};

export default finishTurnTool;
