import { getUserProfile } from "../long-term-memory.js";
import type { ToolDefinition, ToolModule } from "../types.ts";

/** get_user_profile 工具入参 */
export interface GetUserProfileParams {
    id: string;
}

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "get_user_profile",
        description: "根据用户 ID 获取该用户的画像信息，可用于了解特定用户的偏好、性格等",
        parameters: {
            type: "object",
            properties: {
                id: {
                    type: "string",
                    description: "用户的 ID（QQ 号或微信加密 ID）",
                },
            },
            required: ["id"],
        },
    },
};

/** 获取指定用户的画像信息 */
export async function execute(param: GetUserProfileParams): Promise<string> {
    const id = param?.id;
    if (!id) return "缺少用户 ID 参数";
    const profile = await getUserProfile(id);
    if (!profile) return `未找到用户 ${id} 的用户画像`;
    return profile;
}

export default { definition, execute } satisfies ToolModule<GetUserProfileParams>;
