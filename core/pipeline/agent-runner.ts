/**
 * Agent → 通信层的桥接
 * runAgent 负责"挂监听 → 跑循环 → 等分发落定 → 摘监听"的完整生命周期。
 */
import config from "../config.js";
import logger from "../utils/logger.js";
import sleep from "../utils/sleep.js";
import { getAgent } from "../agent/AgentManager.ts";
import type Agent from "../agent/Agent.ts";
import type { Context, MessageSegment } from "../types/index.ts";
import type { ReplyPayload, ToolHold } from "../agent/types.ts";

/** Agent 事件监听器集合：reply 发回复，tool-call 发工具踩点，approval 发门禁询问 */
type AgentListeners = {
    reply: (payload: ReplyPayload) => void;
    "tool-call": (e: { name: string; args: unknown }) => void;
    approval: (holds: ToolHold[]) => void;
};

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
    const onToolCall = ({ name, args }: { name: string; args: unknown }) => {
        if (config.toolOutput) {
            ctx.adapter.sendMsg(ctx.space, `尝试调用${name}，参数为${JSON.stringify(args)}`);
        }
    };
    // 门禁挂起：Agent 循环已停，由这里经适配器发出确认询问，挂起信息不进模型上下文
    const onApproval = (holds: ToolHold[]) => {
        tail = tail
            .then(() => deliverApproval(ctx, holds))
            .catch((err) => logger.error("工具确认询问分发失败:", err));
    };

    const listeners: AgentListeners = { reply: onReply, "tool-call": onToolCall, approval: onApproval };
    attachAgentListeners(agent, listeners);
    try {
        await agent.run(ctx);
    }
    finally {
        detachAgentListeners(agent, listeners);
    }
    await tail;
}

/** 监听器统一挂载 */
function attachAgentListeners(agent: Agent, listeners: AgentListeners): void {
    agent.on("reply", listeners.reply);
    agent.on("tool-call", listeners["tool-call"]);
    agent.on("approval", listeners.approval);
}

function detachAgentListeners(agent: Agent, listeners: AgentListeners): void {
    agent.off("reply", listeners.reply);
    agent.off("tool-call", listeners["tool-call"]);
    agent.off("approval", listeners.approval);
}

/**
 * 把挂起项逐个转成 tool_approval 段交给适配器；适配器自行决定如何渲染（@ 发起人、纯文本等）
 */
async function deliverApproval(ctx: Context, holds: ToolHold[]): Promise<void> {
    for (const hold of holds) {
        await ctx.adapter.sendMsg(ctx.space, {
            type: "tool_approval",
            data: {
                id: hold.id,
                toolName: hold.toolName,
                requestedBy: hold.requestedBy,
                requestedByName: hold.requestedByName,
                reason: hold.reason,
                summary: hold.summary,
            },
        });
    }
}

/**
 * 按段顺序逐个发送一轮回复消息段，段间保留拟人化间隔。
 * reply/mention 依赖与内容同消息，攒到下一个内容段合并发送；
 */
async function deliverReply(ctx: Context, { acts, tokens }: ReplyPayload): Promise<void> {
    logger.info("AI 消息内容:", JSON.stringify({ acts, tokens }));
    let decorations: MessageSegment[] = [];
    for (const seg of acts) {
        if (seg.type === "reply" || seg.type === "mention") {
            decorations.push(seg);
            continue;
        }
        // 空文本不发送也不打断节奏
        if (seg.type === "text" && !(seg.data.text ?? "").trim()) continue;
        const payload: string | MessageSegment | MessageSegment[] =
            decorations.length > 0 ? [...decorations, seg] : seg;
        decorations = [];
        ctx.adapter.sendMsg(ctx.space, payload);
        // 文本是主要节奏（慢），媒体/文件轻快一些
        await sleep(seg.type === "text" ? 3000 + Math.floor(Math.random() * 1000) : 1200 + Math.floor(Math.random() * 800));
    }
    // 结尾落单的修饰段：mention 单发仍有意义，reply 单发无意义丢弃
    for (const seg of decorations) {
        if (seg.type !== "mention") {
            continue;
        }
        ctx.adapter.sendMsg(ctx.space, seg);
        await sleep(1200 + Math.floor(Math.random() * 800));
    }
}
