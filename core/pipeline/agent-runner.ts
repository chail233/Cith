/**
 * Agent → 通信层的桥接
 * runAgent 负责"挂监听 → 跑循环 → 等分发落定 → 摘监听"的完整生命周期。
 */
import config from "../config.js";
import logger from "../utils/logger.js";
import sleep from "../utils/sleep.js";
import { pathToFileURL } from "node:url";
import { getAgent } from "../agent/AgentManager.ts";
import { getSticker } from "../stickers/index.js";
import type Agent from "../agent/Agent.ts";
import type { Context } from "../types/index.ts";
import type { ReplyPayload } from "../agent/types.ts";

/**
 * 运行一次 Agent 对话，并把产生的回复经当前上下文适配器发送
 * @param ctx 管道上下文（提供 space/adapter 等分发所需信息）
 */
export async function runAgent(ctx: Context): Promise<void> {
    const agent = getAgent(ctx.space);

    // 回复发送串行化：多条回复按产出顺序逐条投递，保留拟人化节奏
    let tail = Promise.resolve();
    const onReply = (payload: ReplyPayload) => {
        tail = tail
            .then(() => deliverReply(ctx, payload))//追加
            .catch((err) => logger.error("AI 回复分发失败:", err));
    };
    // 工具调用透明化通知（config.toolOutput 开启时）
    const onToolCall = ({ name, args }: { name: string; args: unknown }) => {
        if (config.toolOutput) {
            ctx.adapter.sendMsg(ctx.space, `尝试调用${name}，参数为${JSON.stringify(args)}`);
        }
    };

    attachAgentListeners(agent, { reply: onReply, "tool-call": onToolCall });
    try {
        await agent.run(ctx);
    }
    finally {
        detachAgentListeners(agent, { reply: onReply, "tool-call": onToolCall });
    }
    await tail;
}

/** 监听器统一挂载 */
function attachAgentListeners(
    agent: Agent,
    listeners: { reply: (payload: ReplyPayload) => void; "tool-call": (e: { name: string; args: unknown }) => void },
): void {
    agent.on("reply", listeners.reply);
    agent.on("tool-call", listeners["tool-call"]);
}

function detachAgentListeners(
    agent: Agent,
    listeners: { reply: (payload: ReplyPayload) => void; "tool-call": (e: { name: string; args: unknown }) => void },
): void {
    agent.off("reply", listeners.reply);
    agent.off("tool-call", listeners["tool-call"]);
}

/** 分段发送一轮回复动作，消息间保留拟人化间隔 */
async function deliverReply(ctx: Context, { acts, tokens }: ReplyPayload): Promise<void> {
    logger.info("AI 消息内容:", JSON.stringify({ acts, tokens }));
    for (const act of acts) {
        // 表情包动作：id → 本地图片 → image 消息段
        if (act.cmd === "sticker") {
            const sticker = getSticker(act.content.trim());
            if (!sticker) {
                logger.warn("表情包发送失败，id 不存在:", act.content);
                continue;
            }
            logger.info("AI 发送表情包:", sticker.id);
            ctx.adapter.sendMsg(ctx.space, [
                { type: "image", data: { file: pathToFileURL(sticker.path).href } },
            ]);
            await sleep(1200 + Math.floor(Math.random() * 800));
            continue;
        }

        if (act.cmd !== "text") continue;
        const content = act.content;
        if (content.trim() === "") continue;
        ctx.adapter.sendMsg(ctx.space, content);
        await sleep(3000 + Math.floor(Math.random() * 1000));
    }
}
