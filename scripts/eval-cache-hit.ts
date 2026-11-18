/**
 * 缓存命中率实测：模拟一段多轮工具调用对话，逐轮计算请求的「结构命中率」
 *
 * 不打真实 API：本地起假 OpenAI 兼容端点，Agent 真实走
 * buildMessages → compactIfNeeded → callLLM 全链路，假端点记录每轮请求，
 * 命中率 = 与上一轮请求公共前缀的 token（估）/ 本轮输入 token（估）。
 * provider 端实际命中 ≤ 此值（还受缓存块粒度与 TTL 影响）。
 *
 * 用法：
 *   node scripts/eval-cache-hit.ts                                  # 生产默认预算 24000，12 轮
 *   node scripts/eval-cache-hit.ts --budgets=24000,8000,4000,2000   # 对比不同工作预算下的命中率
 *   node scripts/eval-cache-hit.ts --rounds=16 --tool-chars=2000    # 更多轮 / 更重的工具输出
 *
 * 阈值即 config.contextBudgetTokens（工作预算）：超预算时最旧的 system 工具痕迹被折叠改写，
 * 前缀随之断裂，命中率下降——--budgets 对比的就是这个效应。
 *
 * token 口径：按项目同款 CHARS_PER_TOKEN=2.5 估算（JSON 长度 / 2.5）。
 * 脚本面向人阅读，使用 console 而不是 utils/logger。
 */
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------- 命令行参数 ----------

function argOf(name: string, fallback: string): string {
    const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}

/** 模拟的工具调用轮数（含最后一轮发言收尾；上限 = toolChainMaxLength 30） */
const ROUNDS = Math.max(2, Math.min(Number(argOf("rounds", "12")) || 12, 30));
/** 每轮工具调用参数里填充的字符数（决定工具痕迹的重量） */
const TOOL_CHARS = Math.max(50, Number(argOf("tool-chars", "600")) || 600);
/** 工作预算对比组（逗号分隔） */
const BUDGETS = argOf("budgets", "24000")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

const CHARS_PER_TOKEN = 2.5;

// ---------- 假端点 ----------

/** 每轮请求的 messages（按顺序记录） */
let received: unknown[][] = [];
/** 按轮编排的响应；前 ROUNDS-1 轮调未知工具（痕迹长=参数长），最后一轮发言收尾 */
let scripted: Array<{ content: string | null; tool_calls?: Array<Record<string, unknown>> }> = [];

function buildScript(): void {
    scripted = [];
    for (let i = 1; i < ROUNDS; i++) {
        const padding = "a".repeat(TOOL_CHARS);
        scripted.push({
            content: null,
            tool_calls: [{
                id: `c${i}`,
                type: "function",
                function: { name: "lookup", arguments: JSON.stringify({ q: `第${i}轮查询 ${padding}` }) },
            }],
        });
    }
    scripted.push({
        content: null,
        tool_calls: [{
            id: `c${ROUNDS}`,
            type: "function",
            function: { name: "send_message", arguments: JSON.stringify({ segments: [{ type: "text", data: { text: "查完了" } }] }) },
        }],
    });
}

let server: ReturnType<typeof createServer> | null = null;

async function startServer(): Promise<number> {
    server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            received.push(body.messages);
            const script = scripted[Math.min(received.length - 1, scripted.length - 1)];
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({
                id: `chatcmpl-${received.length}`,
                object: "chat.completion",
                created: 0,
                model: "test-model",
                choices: [{ index: 0, message: script, finish_reason: script.tool_calls ? "tool_calls" : "stop" }],
                usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            }));
        });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    return server.address().port;
}

// ---------- 命中率计算 ----------

/** 逐条消息的 token 估算（JSON 长度 / CHARS_PER_TOKEN） */
function tokensOf(msgs: unknown[]): number[] {
    return msgs.map((m) => JSON.stringify(m).length / CHARS_PER_TOKEN);
}

/** 与上一轮的最长公共前缀（逐条消息严格相等） */
function prefixStats(prev: unknown[], cur: unknown[]): { shared: number; hit: number; total: number; rate: number; intact: boolean } {
    let shared = 0;
    while (shared < Math.min(prev.length, cur.length)
        && JSON.stringify(prev[shared]) === JSON.stringify(cur[shared])) {
        shared++;
    }
    const tokens = tokensOf(cur);
    const hit = tokens.slice(0, shared).reduce((a, b) => a + b, 0);
    const total = tokens.reduce((a, b) => a + b, 0);
    // 上一轮的消息全部保留（只在尾部追加）= 前缀完整；少了/变了 = 折叠改写导致断裂
    const intact = shared >= prev.length;
    return { shared, hit, total, rate: total > 0 ? hit / total : 0, intact };
}

// ---------- 单组预算跑一轮完整对话 ----------

interface RoundRow {
    round: number;
    hit: number;
    total: number;
    rate: number;
    shared: number;
    intact: boolean;
    /** 本轮新增（未命中）的 token */
    fresh: number;
}

async function runOnce(budget: number): Promise<{ rows: RoundRow[]; avg: number }> {
    received = [];
    buildScript();

    const { default: Agent } = await import("../packages/core/agent/Agent.ts");
    const { ChatRecorder } = await import("../packages/core/agent/recorder.js");
    const { default: config } = await import("../packages/core/config.js");
    const { buildReplyTool } = await import("../packages/core/bot/adapters/reply-tool.ts");
    const { textCap, imageCap } = await import("../packages/core/bot/adapters/reply-segment-caps.ts");

    // 阈值作为变量：热改 config（Proxy 会写回临时 config.json，无污染）
    (config as unknown as Record<string, unknown>).contextBudgetTokens = budget;

    const memory = new ChatRecorder(`cache-eval-${budget}`);
    memory.add({
        role: "user",
        content: {
            name: "测试用户",
            id: "u1",
            time: "2026-11-18 12:00:00",
            message: [{ type: "text", data: { text: "帮我查一下天气，查完告诉我" } }],
        },
    });

    const replyTool = buildReplyTool([textCap(), imageCap()]);
    const agent = new Agent({ sessionId: `cache-eval:${budget}`, memory });
    agent.on("reply", () => {});
    await agent.run({ adapter: { replyTool: () => replyTool } });

    if (received.length !== ROUNDS) {
        console.log(`  ⚠ 实际收到 ${received.length} 轮请求（预期 ${ROUNDS}），结果可能不完整`);
    }

    const rows: RoundRow[] = [];
    for (let i = 1; i < received.length; i++) {
        const s = prefixStats(received[i - 1], received[i]);
        rows.push({
            round: i + 1,
            hit: s.hit,
            total: s.total,
            rate: s.rate,
            shared: s.shared,
            intact: s.intact,
            fresh: Math.round(s.total - s.hit),
        });
    }
    const avg = rows.length > 0 ? rows.reduce((a, r) => a + r.rate, 0) / rows.length : 0;
    return { rows, avg };
}

// ---------- 主流程 ----------

function pct(rate: number): string {
    return `${(rate * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
    const port = await startServer();
    console.log(`假端点 http://127.0.0.1:${port}/v1/chat/completions（无真实 API 请求）`);
    console.log(`场景：单次对话 ${ROUNDS} 轮（前 ${ROUNDS - 1} 轮工具调用，每轮痕迹约 ${Math.round((TOOL_CHARS + 120) / CHARS_PER_TOKEN)} tok，最后发言收尾）`);
    console.log(`token 按 CHARS_PER_TOKEN=${CHARS_PER_TOKEN} 估算；命中率 = 与上一轮公共前缀的 token 占比（理论值，实际 ≤ 此值）\n`);

    // 配置与数据根指进临时目录后再加载项目模块
    const dataRoot = mkdtempSync(join(tmpdir(), "cith-cache-eval-data-"));
    const configDir = mkdtempSync(join(tmpdir(), "cith-cache-eval-cfg-"));
    mkdirSync(join(dataRoot, "skills"), { recursive: true });
    mkdirSync(join(dataRoot, "prompts"), { recursive: true });
    writeFileSync(join(dataRoot, "prompts", "system.md"), "你是测试助手", "utf-8");
    writeFileSync(join(configDir, "config.json"), JSON.stringify({
        chatModel: "test-model",
        llmApiUrl: `http://127.0.0.1:${port}/v1/chat/completions`,
        aiApiKey: "test-key",
        chatSummaryThresholdTokens: 0,
        contextBudgetTokens: BUDGETS[0],
    }), "utf-8");
    process.env.CITH_DATA = dataRoot;
    process.env.CITH_CONFIG = join(configDir, "config.json");

    const results: Array<{ budget: number; avg: number; firstBreak: number | null; rows: RoundRow[] }> = [];

    for (const budget of BUDGETS) {
        console.log(`──────── 预算 contextBudgetTokens=${budget} ────────`);
        console.log("轮次  输入tok(估)  命中tok(估)  新增tok  命中率   备注");
        const { rows, avg } = await runOnce(budget);
        const firstBreak = rows.find((r) => !r.intact)?.round ?? null;
        for (const r of rows) {
            const note = r.intact ? "前缀完整（尾部追加）" : `折叠致断裂：第 ${r.shared + 1} 条起重建`;
            console.log(
                `${String(r.round).padEnd(5)} ${Math.round(r.total).toString().padEnd(12)} ${Math.round(r.hit).toString().padEnd(12)} ${r.fresh.toString().padEnd(8)} ${pct(r.rate).padEnd(8)} ${note}`,
            );
        }
        console.log(`平均命中率（第 2 轮起）：${pct(avg)}\n`);
        results.push({ budget, avg, firstBreak, rows });
    }

    if (results.length > 1) {
        console.log("──────── 预算对比汇总 ────────");
        console.log("预算      平均命中率   首次折叠断裂轮");
        for (const r of results) {
            console.log(
                `${String(r.budget).padEnd(9)} ${pct(r.avg).padEnd(12)} ${r.firstBreak ?? "-"}`,
            );
        }
    }

    server?.close();
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
}

await main();
