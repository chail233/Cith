/**
 * 发言工具实测：给真实模型一组场景，看它会不会自己用 send_message 说话、参数对不对
 *
 * 用法：
 *   node scripts/eval-reply-tool.ts                     # 极简系统提示（不含任何输出格式要求）
 *   node scripts/eval-reply-tool.ts --prompt=file       # 用 core/prompts/system.md 当系统提示（当前生产版本）
 *   node scripts/eval-reply-tool.ts --prompt=hint       # 极简提示 + 一句「发言调用 send_message」
 *   node scripts/eval-reply-tool.ts --repeat=3          # 每个场景重复 3 次，看稳定性
 *   node scripts/eval-reply-tool.ts --only=mention      # 只跑 id 含 mention 的场景
 *
 * 判定口径：
 *   - 调用：本轮确实调用了发言工具
 *   - 参数合法：工具参数能解析成消息段（execute 没有返回错误文本）
 *   - 达成：解析出的消息段符合该场景的意图
 *   - 绕道：没调工具、直接输出纯文本（生产里不会发出任何消息）
 *
 * 说明：这里用真实模型与真实配置（core/config.json），会产生 API 费用；场景数 11，串行请求。
 * 脚本面向人阅读，与 diagnose-tool-calls.ts 一致使用 console 而不是 utils/logger。
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import config from "../core/config.js";
import { callLLM } from "../core/agent/client.ts";
import { readSystemPrompt } from "../core/services/prompt-store.ts";
import OnebotAdapter from "../core/bot/adapters/OnebotAdapter.ts";
import { REPLY_TOOL_NAME } from "../core/bot/adapters/reply-tool.ts";
import type { ReplyTool } from "../core/bot/adapters/reply-tool.ts";
import type { LlmMessage } from "../core/agent/client.ts";
import type { ToolDefinition } from "../core/agent/types.ts";
import type { MessageSegment } from "../core/types/index.ts";

// ---------- 命令行参数 ----------

function argOf(name: string, fallback: string): string {
    const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}

/** 系统提示词版本：bare 什么都不要求，hint 只多一句「用工具发言」 */
const PROMPT_KIND = argOf("prompt", "bare");
/** 每个场景重复次数 */
const REPEAT = Math.max(1, Math.min(Number(argOf("repeat", "1")) || 1, 10));
/** 只跑 id 含该子串的场景 */
const ONLY = argOf("only", "").trim();

/** 系统提示词：bare / hint 都是「不规定消息格式」的对照组 */
const PROMPTS: Record<string, string> = {
    bare: "你是 Cith，一个住在 QQ 群里的 AI 助手，群友会 @ 你或者私聊你。",
    hint: "你是 Cith，一个住在 QQ 群里的 AI 助手，群友会 @ 你或者私聊你。要说话时调用 send_message 工具。",
};

const SYSTEM = PROMPT_KIND === "file" ? readSystemPrompt() : (PROMPTS[PROMPT_KIND] ?? PROMPTS.bare);

// ---------- 场景定义 ----------

/** 场景里额外提供的一个桩工具，调用后返回固定文本 */
interface StubTool {
    definition: ToolDefinition;
    run: () => string;
}

interface Scene {
    id: string;
    label: string;
    /** 本轮用户消息（与生产同构：{name,id,time,messageId?,message}） */
    content: Record<string, unknown>;
    /** 本轮之前的历史消息，留给模型找 id / 上下文 */
    history?: Record<string, unknown>[];
    /** 额外提供的桩工具 */
    stubs?: StubTool[];
    /** 期望：发言（默认）或不发言 */
    expect?: "reply" | "silence";
    /** 意图判定：拿到解析后的消息段后是否达成 */
    check: (acts: MessageSegment[]) => { ok: boolean; note: string };
}

/** 造一条群消息（history 形态与 pipeline 写入 memory 的一致） */
function userContent(message: MessageSegment[], extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { name: "群友A", id: "20002", time: "2026-11-10 21:04", ...extra, message };
}

function text(t: string): MessageSegment {
    return { type: "text", data: { text: t } };
}

const STICKER: MessageSegment = {
    type: "image",
    data: { media: { uri: "https://gchat.qpic.cn/gchatpic/abc", localPath: "core/data/images/abc.jpg" }, alt: "[动画表情]" },
};

function dataOf(seg: MessageSegment): Record<string, unknown> {
    return seg.data as Record<string, unknown>;
}

function textOf(acts: MessageSegment[]): string {
    return acts.map((s) => (s.type === "text" ? String(dataOf(s).text ?? "") : "")).join("");
}

const TIME_STUB: StubTool = {
    definition: {
        type: "function",
        function: {
            name: "get_time",
            description: "获取当前时间",
            parameters: { type: "object", properties: {}, additionalProperties: false },
        },
    },
    run: () => "2026-11-10 21:04（星期二）",
};

const SCENES: Scene[] = [
    {
        id: "greeting",
        label: "只回一句话（不该带引用或 @ 人）",
        content: userContent([text("在吗")]),
        check: (acts) => {
            const texts = acts.filter((s) => s.type === "text");
            if (texts.length === 0 || textOf(acts).trim() === "") return { ok: false, note: "没有发出任何文本" };
            const noisy = acts.filter((s) => s.type !== "text");
            return noisy.length === 0
                ? { ok: true, note: "" }
                : { ok: false, note: `没人要求却带了 ${noisy.map((s) => s.type).join("/")} 段` };
        },
    },
    {
        id: "split",
        label: "拆成多条发（连发节奏）",
        content: userContent([text("把「我在」这两个字分成三条发给我，我要看连发的效果")]),
        check: (acts) => {
            const texts = acts.filter((s) => s.type === "text");
            return { ok: texts.length >= 2, note: texts.length >= 2 ? "" : `只发了 ${texts.length} 条` };
        },
    },
    {
        id: "mention-person",
        label: "@ 历史里出现过的群友",
        content: userContent([text("帮我 @ 一下小明，让他看群公告")]),
        history: [
            userContent([
                { type: "mention", data: { id: "10001", name: "小明" } },
                text("小明，上次那份文档你看完了吗"),
            ], { name: "群友B", id: "20003", time: "2026-11-10 21:01", messageId: "8839" }),
        ],
        check: (acts) => {
            const mention = acts.find((s) => s.type === "mention");
            if (!mention) return { ok: false, note: "没有 mention 段" };
            const id = String(dataOf(mention).id ?? "");
            return { ok: id === "10001", note: id === "10001" ? "" : `@ 错人：${id || "(空)"}（历史里小明的 id 是 10001）` };
        },
    },
    {
        id: "mention-all",
        label: "@ 全体成员",
        content: userContent([text("用 @全体成员 发一条开会通知")]),
        check: (acts) => {
            const mention = acts.find((s) => s.type === "mention");
            if (!mention) return { ok: false, note: "没有 mention 段" };
            const id = String(dataOf(mention).id ?? "");
            return { ok: id === "all", note: id === "all" ? "" : `id 应为 all，实为 ${id || "(空)"}` };
        },
    },
    {
        id: "quote",
        label: "引用回复当前消息",
        content: userContent([text("引用我这句话，回一句收到")], { messageId: "8842" }),
        check: (acts) => {
            const quote = acts.find((s) => s.type === "reply");
            if (!quote) return { ok: false, note: "没有 reply 段" };
            const id = String(dataOf(quote).id ?? "");
            return { ok: id !== "", note: id ? "" : "reply 的 id 为空" };
        },
    },
    {
        id: "image-echo",
        label: "把收到的图片再发一遍",
        content: userContent([STICKER, text("这张图你帮我再发一遍")]),
        check: (acts) => {
            const image = acts.find((s) => s.type === "image");
            if (!image) return { ok: false, note: "没有 image 段" };
            const media = dataOf(image).media as { localPath?: string; uri?: string } | undefined;
            const ref = media?.localPath ?? media?.uri ?? "";
            return { ok: ref.includes("abc"), note: ref.includes("abc") ? "" : `图片引用不对：${ref}` };
        },
    },
    {
        id: "file-send",
        label: "发本地文件",
        content: userContent([text("把 workspace/报告.pdf 发给我")]),
        check: (acts) => {
            const file = acts.find((s) => s.type === "file");
            if (!file) return { ok: false, note: "没有 file 段" };
            const media = dataOf(file).media as { localPath?: string } | undefined;
            const path = media?.localPath ?? "";
            return { ok: path.includes("报告.pdf"), note: path.includes("报告.pdf") ? "" : `路径不对：${path || "(空)"}` };
        },
    },
    {
        id: "mixed",
        label: "@ + 文本 + 图片混发",
        content: userContent([STICKER, text("先 @ 小明，说一句「你看这个」，再把这图发出来")]),
        history: [
            userContent([
                { type: "mention", data: { id: "10001", name: "小明" } },
                text("小明，这个方案你看下"),
            ], { name: "群友B", id: "20003", time: "2026-11-10 21:02", messageId: "8840" }),
        ],
        check: (acts) => {
            const has = (t: string) => acts.some((s) => s.type === t);
            const missing = ["mention", "text", "image"].filter((t) => !has(t));
            return { ok: missing.length === 0, note: missing.length === 0 ? "" : `缺 ${missing.join("/")}` };
        },
    },
    {
        id: "tool-then-reply",
        label: "先查工具再发言",
        content: userContent([text("现在几点了？告诉我")]),
        stubs: [TIME_STUB],
        check: (acts) => {
            const ok = textOf(acts).includes("21:04");
            return { ok, note: ok ? "" : "发言里没有工具查到的时间" };
        },
    },
    {
        id: "silence",
        label: "一句无需回应的闲聊（应选择不发言）",
        content: userContent([text("（只是路过看看）")]),
        expect: "silence",
        check: () => ({ ok: true, note: "" }),
    },
    {
        id: "long-explain",
        label: "稍长的解释",
        content: userContent([text("用三句话说明什么是向量数据库")]),
        check: (acts) => {
            const body = textOf(acts).trim();
            return { ok: body.length >= 40, note: body.length >= 40 ? "" : `只有 ${body.length} 字` };
        },
    },
];

// ---------- 单场景执行 ----------

interface Attempt {
    /** 是否调用了发言工具 */
    called: boolean;
    /** 是否同一轮还调了别的工具 */
    mixedRound: boolean;
    /** 解析出的消息段 */
    acts: MessageSegment[];
    /** 参数不合法时回给模型的错误文本 */
    paramError: string;
    /** 未调用工具时模型输出的纯文本 */
    plain: string;
    /** 每轮调用的工具名轨迹 */
    rounds: string[];
    /** 请求失败 */
    error: string;
    ok: boolean;
    note: string;
}

function summarizeActs(acts: MessageSegment[]): string {
    const parts = acts.map((s) => {
        if (s.type === "text") {
            const t = String(dataOf(s).text ?? "");
            return `text(${t.length}字)`;
        }
        if (s.type === "mention") return `mention(${String(dataOf(s).id ?? "")})`;
        if (s.type === "reply") return `reply(${String(dataOf(s).id ?? "")})`;
        if (s.type === "image" || s.type === "file") {
            const media = dataOf(s).media as { localPath?: string; uri?: string } | undefined;
            return `${s.type}(${media?.localPath ?? media?.uri ?? "?"})`;
        }
        return s.type;
    });
    return parts.join(" → ");
}

async function runScene(scene: Scene, replyTool: ReplyTool): Promise<Attempt> {
    const stubDefs = (scene.stubs ?? []).map((s) => s.definition);
    /** 允许被引用的 messageId：当前消息 + 历史消息里真实出现过的 */
    const allowedReplyIds = [scene.content.messageId, ...(scene.history ?? []).map((h) => h.messageId)]
        .filter((v): v is string => typeof v === "string" && v !== "");
    const messages: LlmMessage[] = [
        { role: "system", content: SYSTEM },
        ...(scene.history ?? []).map((c) => ({ role: "user", content: JSON.stringify(c) })),
        { role: "user", content: JSON.stringify(scene.content) },
    ];
    const rounds: string[] = [];

    const base: Attempt = {
        called: false, mixedRound: false, acts: [], paramError: "",
        plain: "", rounds, error: "", ok: false, note: "",
    };

    for (let round = 1; round <= 4; round++) {
        const result = await callLLM({
            model: config.chatModel,
            messages,
            temperature: 0.2,
            tools: [...stubDefs, replyTool.definition],
        });
        if (typeof result === "string") return { ...base, error: result };

        const calls = result.message.tool_calls ?? [];
        rounds.push(calls.map((c) => c.function.name).join("+") || "(无工具)");

        const replyCalls = calls.filter((c) => c.function.name === REPLY_TOOL_NAME);
        if (replyCalls.length > 0) {
            const mixed = calls.length > replyCalls.length;
            const call = replyCalls[0];
            let param: unknown;
            try {
                param = JSON.parse(call.function.arguments || "{}");
            }
            catch {
                return { ...base, called: true, mixedRound: mixed, paramError: "参数不是合法 JSON" };
            }
            const output = await replyTool.execute(param);
            if (typeof output === "string") {
                return { ...base, called: true, mixedRound: mixed, paramError: output };
            }
            // 编造引用 id（拿不存在的 messageId 去引用）是真实缺陷，所有场景统一拦截
            const bogus = output.acts
                .filter((s) => s.type === "reply")
                .map((s) => String(dataOf(s).id ?? ""))
                .filter((id) => !allowedReplyIds.includes(id));
            const verdict = bogus.length > 0
                ? { ok: false, note: `编造引用 id：${bogus.join(",")}（实际可用：${allowedReplyIds.join(",") || "无"}）` }
                : scene.check(output.acts);
            return { ...base, called: true, mixedRound: mixed, acts: output.acts, ok: verdict.ok, note: verdict.note };
        }

        if (calls.length === 0) {
            return { ...base, plain: (result.message.content ?? "").trim() };
        }

        // 桩工具执行后按生产格式回填：role=system + {text:"调用了工具 …结果：…"}
        for (const call of calls) {
            const stub = (scene.stubs ?? []).find((s) => s.definition.function.name === call.function.name);
            const out = stub ? stub.run() : `未知工具：${call.function.name}`;
            messages.push({
                role: "system",
                content: JSON.stringify({ text: `调用了工具 ${call.function.name}，参数：${call.function.arguments}，结果：${out}` }),
            });
        }
    }

    return { ...base, error: "4 轮内没有收敛" };
}

// ---------- 主流程 ----------

function oneLine(text: string, limit = 70): string {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

interface Tally {
    scenes: number;
    called: number;
    parsed: number;
    achieved: number;
    plain: number;
    failed: number;
}

async function main(): Promise<void> {
    if (!config.aiApiKey || !config.llmApiUrl) {
        console.log("配置里缺少 llmApiUrl / aiApiKey，无法实测。请先跑 npm run setup。");
        return;
    }
    // 用真实 OneBot 适配器生成发言工具：schema 与生产完全一致
    const adapter = new OnebotAdapter(async () => {}, { send: () => {} });
    const replyTool = adapter.replyTool();

    const scenes = ONLY === "" ? SCENES : SCENES.filter((s) => s.id.includes(ONLY));
    const tally: Tally = { scenes: 0, called: 0, parsed: 0, achieved: 0, plain: 0, failed: 0 };
    const lines: string[] = [];

    console.log(`模型 ${config.chatModel} | 提示词 ${PROMPT_KIND}（${SYSTEM.length} 字）| 场景 ${scenes.length} 个 × ${REPEAT} 次`);
    console.log(`系统提示：${oneLine(SYSTEM, 120)}`);
    lines.push(`# 发言工具实测`, "", `- 模型：\`${config.chatModel}\``, `- 提示词：${PROMPT_KIND}（${SYSTEM.length} 字）`, `- 场景 ${scenes.length} 个 × ${REPEAT} 次`, "", `> ${oneLine(SYSTEM, 200)}`, "");

    for (const scene of scenes) {
        for (let i = 1; i <= REPEAT; i++) {
            const at = await runScene(scene, replyTool);
            tally.scenes++;
            if (at.error) {
                tally.failed++;
                console.log(`✗ ${scene.id} #${i} 请求失败：${at.error}`);
                lines.push(`- ✗ **${scene.id}** #${i} 请求失败：${at.error}`);
                continue;
            }
            if (!at.called) {
                // 没调工具：生产里不发任何消息，不算「表达了不发言」
                tally.plain++;
                const why = scene.expect === "silence" ? "（想沉默却没调工具）" : "";
                console.log(`✗ ${scene.id} #${i} 未调用工具，直接输出纯文本：${oneLine(at.plain, 90)}${why}`);
                lines.push(`- ✗ **${scene.id}** #${i} 未调用工具，直接输出纯文本：${oneLine(at.plain, 120)}${why}`);
                continue;
            }
            tally.called++;
            if (at.paramError) {
                console.log(`✗ ${scene.id} #${i} 参数不合法：${at.paramError}`);
                lines.push(`- ✗ **${scene.id}** #${i} 参数不合法：${at.paramError}`);
                continue;
            }
            tally.parsed++;
            // 期望沉默：只有「调用工具但传空数组」才算达成
            const verdict = scene.expect === "silence"
                ? (at.acts.length === 0
                    ? { ok: true, note: "用空数组表达了不发言" }
                    : { ok: false, note: `仍然发了 ${at.acts.length} 段` })
                : { ok: at.ok, note: at.note };
            if (verdict.ok) tally.achieved++;
            const mark = verdict.ok ? "✓" : "△";
            // 未达成时把正文也带上，方便看出它把段当文本写了还是真的走错
            const excerpt = verdict.ok ? "" : `正文：「${oneLine(textOf(at.acts), 50)}」`;
            const extra = [at.mixedRound ? "同轮还调了别的工具" : "", verdict.note, excerpt].filter(Boolean).join("；");
            console.log(`${mark} ${scene.id} #${i} [${scene.label}] ${summarizeActs(at.acts)}${extra ? `（${extra}）` : ""}`);
            lines.push(`- ${mark} **${scene.id}** #${i} [${scene.label}] \`${summarizeActs(at.acts)}\`${extra ? `（${extra}）` : ""}`);
        }
    }

    const pct = (n: number) => `${Math.round((n / Math.max(tally.scenes, 1)) * 100)}%`;
    const summary = [
        "",
        `调用率   ${tally.called}/${tally.scenes}  ${pct(tally.called)}`,
        `参数合法 ${tally.parsed}/${tally.scenes}  ${pct(tally.parsed)}`,
        `意图达成 ${tally.achieved}/${tally.scenes}  ${pct(tally.achieved)}`,
        `绕道纯文本 ${tally.plain} | 请求失败 ${tally.failed}`,
    ];
    console.log(summary.join("\n"));
    lines.push("", "## 汇总", "", "```", ...summary.slice(1), "```", "");

    const reportPath = join(tmpdir(), "eval-reply-tool.md");
    writeFileSync(reportPath, lines.join("\n"), "utf8");
    console.log(`\n报告已写入 ${reportPath}`);
}

await main();
