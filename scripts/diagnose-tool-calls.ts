/**
 * 工具调用诊断脚本：定位「模型在文本里说要调用工具，却没有返回 tool_calls」的原因
 *
 * 用法：node scripts/diagnose-tool-calls.ts [每组重复次数，默认 2]
 *
 * 四组对照（temperature 固定 0.2，串行请求，避免服务端并发限制干扰）：
 *   A 生产复刻：真实 system.md + 8 个真实工具 + response_format: json_object
 *   B 同 A，但不传 response_format
 *   C 最小对照：极简 system + 1 个天气工具 + response_format: json_object
 *   D 同 C，但不传 response_format
 *
 * 「会不会用工具说话」的实测在 scripts/eval-reply-tool.ts，不在本脚本范围。
 *
 * 判定口径：
 *   - 命中：返回了 tool_calls
 *   - 嘴上说要调用：无 tool_calls，但文本里出现「调用/查一下/搜索/执行/让我」等意图词
 *   - 静默：既没调用也没表态（比如只回了句客套话）
 *
 * 本脚本直接输出到终端（面向人阅读），因此使用 console 而非 utils/logger。
 */
import OpenAI from "openai";
import { readFile } from "node:fs/promises";
import config from "../core/config.js";
import type { ToolDefinition } from "../core/agent/types.ts";

import getMemoryTool from "../core/agent/tools/get-memory.ts";
import manageMcpTool from "../core/agent/tools/manage-mcp.ts";
import listStickersTool from "../core/agent/tools/list-stickers.ts";
import managePlanTool from "../core/agent/tools/manage-plan.ts";
import scheduleTool from "../core/agent/tools/schedule.ts";
import reportProgressTool from "../core/agent/tools/report-progress.ts";
import recognizeImageTool from "../core/agent/tools/recognize-image.ts";
import runShellTool from "../core/agent/tools/run-shell.ts";

/** 每组重复次数（命令行第一个参数） */
const REPEAT = Math.max(1, Math.min(Number(process.argv[2] ?? 2) || 2, 10));

/** 只跑指定组（环境变量 CASE，如 CASE=E 或 CASE=B,E），留空跑全部 */
const ONLY = (process.env.CASE ?? "").trim().toUpperCase().split(",").filter(Boolean);

/** 单次请求超时：思考型模型比生产用的 60s 需要更多余量 */
const TIMEOUT = 180_000;

/** 真实工具集合（与 agent/tools.js 的 toolRegistry 保持一致，不含 MCP 动态工具） */
const REAL_TOOLS: ToolDefinition[] = [
    getMemoryTool,
    manageMcpTool,
    listStickersTool,
    managePlanTool,
    scheduleTool,
    reportProgressTool,
    recognizeImageTool,
    runShellTool,
].map((mod) => mod.definition);

/** 最小对照用的天气工具 */
const WEATHER_TOOL: ToolDefinition = {
    type: "function",
    function: {
        name: "get_weather",
        description: "查询指定城市的实时天气",
        parameters: {
            type: "object",
            properties: { city: { type: "string", description: "城市名称" } },
            required: ["city"],
        },
    },
};

/** 极简 system：只讲清「要调工具」，不带任何输出格式约束 */
const MIN_SYSTEM = "你是助手。需要外部信息或需要执行操作时，必须调用对应的工具，不要只是在回复里说要调用。";

/** 意图词：用于识别「嘴上说要调用」 */
const INTENT_RE = /调用|查一下|查查|查询|搜索|搜一下|执行|让我|稍等|读取|看看|看一下|马上/;

/** 一组实验的定义 */
interface CaseDef {
    id: string;
    label: string;
    system: string;
    tools: ToolDefinition[];
    jsonMode: boolean;
    question: string;
}

/** 一组实验的统计 */
interface Stats {
    /** 命中 tool_calls 的次数 */
    hit: number;
    /** 声称要调用但没有 tool_calls 的次数 */
    claimed: number;
    /** 既没调用也没表态的次数 */
    silent: number;
    /** 请求异常次数 */
    error: number;
}

/** 单次请求的结果摘要 */
interface Attempt {
    finishReason: string;
    thinkingChars: number;
    toolNames: string[];
    content: string;
}

function newStats(): Stats {
    return { hit: 0, claimed: 0, silent: 0, error: 0 };
}

/** 去掉尾部 /chat/completions 与多余斜杠，与 agent/client.ts 的归一化保持一致 */
function normalizeBaseURL(url: string): string {
    return url.replace(/\/chat\/completions\/?$/, "").replace(/\/+$/, "");
}

/** 单行化文本，便于表格输出 */
function oneLine(text: string, limit = 90): string {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/** 发一次请求并提取诊断字段 */
async function ask(client: OpenAI, c: CaseDef): Promise<Attempt> {
    const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
        model: config.chatModel,
        messages: [
            { role: "system", content: c.system },
            { role: "user", content: c.question },
        ],
        temperature: 0.2,
        ...(c.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
        ...(c.tools.length > 0 ? { tools: c.tools as unknown as OpenAI.Chat.ChatCompletionTool[] } : {}),
    };

    const completion = await client.chat.completions.create(body);
    const choice = completion.choices[0];
    const message = choice?.message;
    const rawCalls = (message?.tool_calls ?? []) as Array<{ type: string; function?: { name?: string } }>;
    const content = typeof message?.content === "string" ? message.content : "";
    // reasoning_content 是思考型模型的非标准字段，SDK 类型里没有
    const reasoning = (message as Record<string, unknown> | undefined)?.reasoning_content;
    const thinking = typeof reasoning === "string" ? reasoning : "";

    return {
        finishReason: choice?.finish_reason ?? "—",
        thinkingChars: thinking.length,
        toolNames: rawCalls.filter((call) => call.type === "function").map((call) => call.function?.name ?? "?"),
        content,
    };
}

/** 跑完一组，返回统计 */
async function runCase(client: OpenAI, c: CaseDef, stats: Stats): Promise<void> {
    console.log(`\n=== ${c.id}. ${c.label} ===`);
    console.log(`   system: ${c.system.length} 字 | tools: ${c.tools.length} 个 / ${JSON.stringify(c.tools).length} 字符 | response_format: ${c.jsonMode ? "json_object" : "未传"}`);
    console.log(`   提问: ${c.question}`);

    for (let i = 1; i <= REPEAT; i++) {
        try {
            const attempt = await ask(client, c);
            if (attempt.toolNames.length > 0) {
                stats.hit++;
                console.log(`   #${i} ✓ tool_calls=[${attempt.toolNames.join(", ")}] finish=${attempt.finishReason} thinking=${attempt.thinkingChars}字`);
            }
            else if (INTENT_RE.test(attempt.content)) {
                stats.claimed++;
                console.log(`   #${i} ✗ 声称要调用但无 tool_calls | finish=${attempt.finishReason} thinking=${attempt.thinkingChars}字`);
                console.log(`        内容: ${oneLine(attempt.content)}`);
            }
            else {
                stats.silent++;
                console.log(`   #${i} · 静默 | finish=${attempt.finishReason} thinking=${attempt.thinkingChars}字`);
                console.log(`        内容: ${oneLine(attempt.content)}`);
            }
        }
        catch (err) {
            stats.error++;
            console.log(`   #${i} ! 请求失败: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}

async function main(): Promise<void> {
    const apiKey = String(config.aiApiKey ?? "");
    if (!apiKey || apiKey.startsWith("your_")) {
        console.error("core/config.json 里没有配置有效的 aiApiKey，无法诊断");
        process.exit(1);
    }

    const baseURL = normalizeBaseURL(config.llmApiUrl);
    const client = new OpenAI({ baseURL, apiKey, timeout: TIMEOUT });
    const system = await readFile(new URL("../core/prompts/system.md", import.meta.url), "utf-8");

    console.log("=== 当前配置 ===");
    console.log(`   endpoint: ${baseURL}`);
    console.log(`   model   : ${config.chatModel}`);
    console.log(`   每组次数: ${REPEAT}`);

    // 真实工具组：问一个必须查文件系统才能回答的问题，预期 run_shell
    const realQuestion = "帮我看看当前工作目录下有哪些文件，列出来给我";

    const cases: CaseDef[] = [
        { id: "A", label: "生产复刻（真实 system + 真实工具 + json_object）", system, tools: REAL_TOOLS, jsonMode: true, question: realQuestion },
        { id: "B", label: "去掉 response_format（其余同 A）", system, tools: REAL_TOOLS, jsonMode: false, question: realQuestion },
        { id: "C", label: "最小对照（极简 system + 天气工具 + json_object）", system: MIN_SYSTEM, tools: [WEATHER_TOOL], jsonMode: true, question: "北京今天天气怎么样？" },
        { id: "D", label: "去掉 response_format（其余同 C）", system: MIN_SYSTEM, tools: [WEATHER_TOOL], jsonMode: false, question: "北京今天天气怎么样？" },
    ];

    const all: Array<{ id: string; stats: Stats }> = [];
    for (const c of cases.filter((item) => ONLY.length === 0 || ONLY.includes(item.id))) {
        const stats = newStats();
        await runCase(client, c, stats);
        all.push({ id: c.id, stats });
    }

    console.log("\n=== 汇总 ===");
    console.log("组别 | 符合预期 | 声称未调/违规 | 静默 | 失败 | 命中率");
    for (const { id, stats } of all) {
        const total = stats.hit + stats.claimed + stats.silent;
        const rate = total > 0 ? `${Math.round((stats.hit / total) * 100)}%` : "—";
        console.log(`${id}    | ${stats.hit}        | ${stats.claimed}             | ${stats.silent}    | ${stats.error}    | ${rate}`);
    }

    console.log("\n判读建议：");
    console.log("  A 差而 B 好  → response_format:json_object 与 tools 冲突，被服务商忽略/压制了工具调用");
    console.log("  A、B 都差    → 模型本身在该 provider 下不愿调工具，需调 system 提示（明确“先说就要做”）或换模型");
    console.log("  C、D 正常    → 协议与工具链没问题，问题出在真实 system.md 的约束上");
}

main().catch((err) => {
    console.error("诊断脚本异常退出:", err);
    process.exit(1);
});
