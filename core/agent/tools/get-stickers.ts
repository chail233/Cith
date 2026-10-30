import { queryStickers, listTags } from "../../stickers/index.js";
import type { ToolDefinition, ToolModule } from "../types.ts";

/** get_stickers 工具入参 */
export interface GetStickersParams {
    tag?: string;
    limit?: number;
}

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "get_stickers",
        description: "按标签检索表情包，返回表情包 id、画面描述和标签。想发表情包时先调用本工具拿到 id，再在 action 数组中添加 {\"cmd\":\"sticker\",\"content\":\"id\"} 发送。根据情境适当选择，不应滥用。",
        parameters: {
            type: "object",
            properties: {
                tag: {
                    type: "string",
                    description: "表情包标签（情绪或使用场景），可从系统消息的表情包tags里挑",
                },
                limit: {
                    type: "integer",
                    description: "返回条数，默认 5，最大 10",
                },
            },
        },
    },
};

/** 按标签检索表情包候选 */
export async function execute(param: GetStickersParams): Promise<string> {
    const tag = typeof param?.tag === "string" ? param.tag.trim().replace(/^#/, "") : "";
    const rawLimit = Number(param?.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 10) : 5;

    if (!tag) {
        const tags = listTags();
        if (tags.length === 0) return "表情包库为空";
        return `可用表情包标签：${tags.map((t) => `${t.tag}(${t.count})`).join("、")}\n请传入其中一个 tag 检索`;
    }

    const matched = queryStickers({ tags: [tag], limit });
    if (matched.length === 0) {
        const tags = listTags();
        const available = tags.length > 0
            ? `可用标签：${tags.map((t) => t.tag).join("、")}`
            : "表情包库为空";
        return `没有匹配标签 "${tag}" 的表情包。${available}`;
    }

    const lines = matched.map((item) =>
        `- id: ${item.id}  描述：${item.desc}  标签：${item.tags.join("、") || "无"}`,
    );
    return [`标签 "${tag}" 的表情包（发送时 content 填 id）：`, ...lines].join("\n");
}

export default { definition, execute } satisfies ToolModule<GetStickersParams>;
