import { callLLM } from "./client.ts";
import { buildMessages } from "./contextBuilder.ts";
import config from "../config.js";
import logger from "../utils/logger.js";
import type Agent from "./Agent.ts";
import type { ToolCall, ToolContext, ToolModule } from "./types.ts";
import { addNote, deleteNote, updateNote } from "../services/notes-store.ts";

/** 维护 pass 的最大请求轮数 */
const NOTE_PASS_MAX_ROUNDS = 6;

/** 维护指令：交代上下文即将被摘要压缩，引导模型自主整理笔记 */
const NOTES_PASS_PROMPT = [
    "【全局笔记维护】上面是你最近一段对话的完整上下文，它稍后会被摘要压缩，压缩后原文将不再可见。",
    "请回顾这段对话，用笔记工具维护你的全局笔记：",
    "- 自我认知：对自己性格、说话与做事方式、与各成员关系的新认识；",
    "- 想亲自记住的事：承诺、约定、重要事实、经验教训；",
    "- 已有笔记与现实不符或已经过时的，用 update_note 修正或 delete_note 删除。",
    "笔记一条只写一件事，简洁、能脱离上下文单独理解；不要记琐碎闲聊和转瞬即逝的话题。",
    "没有需要变动的内容时，不要调用任何工具，直接结束。",
].join("\n");

interface NoteContentParams {
    content?: unknown;
}

interface NoteIdParams {
    id?: unknown;
}

/** 三个工具共用的参数 schema 片段 */
const noteIdProperty = {
    type: "string",
    description: "笔记编号，见上下文里你的笔记列表（如 n3）",
};
const noteContentProperty = {
    type: "string",
    description: "笔记内容，一条只写一件事，简洁、能脱离上下文单独理解",
};

const addNoteTool = {
    definition: {
        type: "function" as const,
        function: {
            name: "add_note",
            description: "往全局笔记里新增一条你想长期记住的内容（自我认知、承诺约定、重要事实、经验教训）",
            parameters: {
                type: "object",
                properties: { content: noteContentProperty },
                required: ["content"],
            },
        },
    },
    execute: async (param: unknown, _ctx?: ToolContext) => {
        const p = (param ?? {}) as NoteContentParams;
        return addNote(p.content);
    },
} satisfies ToolModule;

const updateNoteTool = {
    definition: {
        type: "function" as const,
        function: {
            name: "update_note",
            description: "修改一条已有全局笔记的内容",
            parameters: {
                type: "object",
                properties: { id: noteIdProperty, content: noteContentProperty },
                required: ["id", "content"],
            },
        },
    },
    execute: async (param: unknown, _ctx?: ToolContext) => {
        const p = (param ?? {}) as NoteIdParams & NoteContentParams;
        return updateNote(p.id, p.content);
    },
} satisfies ToolModule;

const deleteNoteTool = {
    definition: {
        type: "function" as const,
        function: {
            name: "delete_note",
            description: "删除一条已过时或不再需要的全局笔记",
            parameters: {
                type: "object",
                properties: { id: noteIdProperty },
                required: ["id"],
            },
        },
    },
    execute: async (param: unknown, _ctx?: ToolContext) => {
        const p = (param ?? {}) as NoteIdParams;
        return deleteNote(p.id);
    },
} satisfies ToolModule;

const noteTools = [addNoteTool, updateNoteTool, deleteNoteTool];
const noteToolMap = new Map(noteTools.map((t) => [t.definition.function.name, t]));

/**
 * 执行单条笔记工具调用
 * 参数解析与执行异常统一转成错误文本，让模型自我修正
 */
async function execNoteTool(call: ToolCall): Promise<string> {
    const tool = noteToolMap.get(call.function.name);
    if (!tool) return `未知工具 ${call.function.name}`;
    let param: unknown;
    try {
        param = JSON.parse(call.function.arguments);
    }
    catch {
        return "参数不是合法 JSON，请按工具定义重新填写";
    }
    try {
        return await tool.execute(param);
    }
    catch (err) {
        return `工具 ${call.function.name} 执行失败：${err instanceof Error ? err.message : String(err)}`;
    }
}


export async function runNotesMaintenance(agent: Agent): Promise<void> {
    const threshold = config.chatSummaryThresholdTokens;
    if (!Number.isFinite(threshold) || threshold <= 0) return;
    const estimated = agent.memory.estimatedTokens;
    if (!Number.isFinite(estimated) || estimated <= threshold) return;

    const messages = await buildMessages(agent, { notesPass: true });
    messages.push({ role: "system", content: NOTES_PASS_PROMPT });
    logger.info("开始笔记维护:", agent.sessionId);

    let calls = 0;
    for (let depth = 0; depth < NOTE_PASS_MAX_ROUNDS; depth++) {
        const result = await callLLM({
            model: config.chatModel,
            messages,
            temperature: 0.2,
            tools: noteTools.map((t) => t.definition),
        });
        if (typeof result === "string") {
            logger.warn("笔记维护请求失败，跳过本轮维护:", result);
            return;
        }
        const toolCalls = result.message.tool_calls ?? [];
        if (toolCalls.length === 0) break; // 模型不再调用工具 = 维护结束

        calls += toolCalls.length;
        // 并行执行，痕迹格式与主循环 recordToolCall 落盘后的线上格式一致
        const traces = await Promise.all(toolCalls.map(async (call) => ({
            role: "system",
            content: JSON.stringify({
                text: `调用了工具 ${call.function.name}，参数：${call.function.arguments}，结果：${await execNoteTool(call)}`,
            }),
        })));
        messages.push(...traces);

        if (depth === NOTE_PASS_MAX_ROUNDS - 1) {
            logger.warn("笔记维护达到轮数上限，强制结束:", agent.sessionId);
        }
    }
    logger.info(`笔记维护完成：${calls} 次工具调用`);
}
