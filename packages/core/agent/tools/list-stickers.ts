import { listStickers } from "../../stickers/index.js";
import type { ToolDefinition, ToolModule } from "../types.ts";

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "list_stickers",
        description: "获取完整表情包列表，每行一条，格式为「路径|画面描述」。想发表情包时先调用本工具，挑选最贴合当前语境的一条，再用 send_message 工具发一个 image 段，把路径填进 data.media.localPath。根据情境适当选择，不应滥用。本次对话中已经返回过列表时直接复用其中的路径，无需重复调用。",
        parameters: {
            type: "object",
            properties: {},
        },
    },
};


function shuffle<T>(items: T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/** 返回完整表情包列表，顺序随机 */
export async function execute(): Promise<string> {
    const items = shuffle(listStickers());
    if (items.length === 0) return "表情包库为空";

    const lines = items.map((item) => `${item.path}|${item.desc}`);
    return ["表情包列表（发送时把路径填进 image 段的 media.localPath）：", ...lines].join("\n");
}

export default { definition, execute } satisfies ToolModule<Record<string, never>>;
