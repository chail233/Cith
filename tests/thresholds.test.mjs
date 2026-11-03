/**
 * 聊天阈值 / 工作阈值的最优取值基准测试
 *
 * 全部跑在本地模拟上，不发起任何真实模型请求：
 * - 真实 ChatRecorder（摘要、折叠、体积判定都是生产代码）
 * - mock 的 callLLM / config / 长期记忆 / logger
 * - 缓存命中按未命中价的 1/10 计价
 *
 * 运行：npm run bench:thresholds
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatSim, CHARS_PER_TOKEN, MODEL_WINDOW_TOKENS, PRICE, loadCore, runSim, sweep } from "./support/threshold-sim.mjs";

/** 默认配置，作为所有对比的基准 */
const DEFAULT_CHAT = 40_000;
const DEFAULT_WORK = 60_000;

/**
 * 候选配置：可用环境变量换成任意组合，便于对比不同方案。
 * BENCH_CHAT=12000 BENCH_WORK=24000 npm test
 */
const CANDIDATE = {
    chatThreshold: Number(process.env.BENCH_CHAT ?? 6_000),
    workBudget: Number(process.env.BENCH_WORK ?? 12_000),
};

const CHAT_GRID = [2_000, 3_000, 4_000, 6_000, 8_000, 12_000, 16_000, 24_000, 40_000];
const WORK_GRID = [2_000, 4_000, 6_000, 8_000, 12_000, 20_000, 40_000, 60_000];

/**
 * 保真门槛：纯成本最优会一路滑到「把所有工具输出都截断」，那不可用，
 * 所以用三个可量化的门槛把「信息被打烂」的配置排除掉。
 */
const FIDELITY = {
    /** 摘要后仍超阈值的次数占比（阈值小于单条工具痕迹时，摘要纯粹白花钱） */
    maxIneffectiveRatio: 0.05,
    /** 每轮结束时平均保留的原文消息条数（user + assistant），约等于还能看到几轮原话 */
    minRetainedMsgs: 6,
    /** 折叠丢掉的字符占原始输入字符的比例 */
    maxFoldLoss: 0.4,
};

const num = (n) => Math.round(n).toLocaleString("en-US");
const pct = (x) => `${(x * 100).toFixed(0)}%`;
const pad = (v, w) => String(v).padStart(w);

/** 折叠丢失率：折叠丢掉的字符 / 会话累计产生的原始字符 */
function foldLoss(r) {
    const raw = r.growthPerRound * CHARS_PER_TOKEN * r.rounds;
    return raw > 0 ? r.foldedChars / raw : 0;
}

function isFaithful(r) {
    const badRatio = r.summaries > 0 ? r.ineffectiveSummaries / r.summaries : 0;
    return (
        !r.overWindow
        && badRatio <= FIDELITY.maxIneffectiveRatio
        && r.avgRetainedMsgs >= FIDELITY.minRetainedMsgs
        && foldLoss(r) <= FIDELITY.maxFoldLoss
    );
}

/** 单行摘要描述，用于只打印几行的场景 */
function describe(r, baseCost) {
    const rel = baseCost ? ` (${pct(r.cost / baseCost)})` : "";
    return `chat=${pad(r.chatThreshold, 5)} work=${pad(r.workBudget, 5)}  cost=${pad(num(r.cost), 9)}${rel}`
        + `  hit=${pct(r.hitRate)}  summaries=${r.summaries}(${r.ineffectiveSummaries} wasted)`
        + `  folded=${r.foldedMsgs}(loss ${pct(foldLoss(r))})  keptMsgs=${r.avgRetainedMsgs.toFixed(1)}`;
}

/** 控制台表格：一行一个配置，列宽固定避免折行 */
function printRows(title, rows, baseCost) {
    console.log(`\n${title}  (raw input per round: ${num(rows[0].growthPerRound)} tokens)`);
    console.log("    chat   work        cost   hit  sum(bad)  fold(loss)     peak  kept   vsDefault");
    for (const r of rows) {
        const rel = baseCost ? `${((r.cost / baseCost) * 100).toFixed(0)}%` : "-";
        console.log(
            `  ${pad(r.chatThreshold, 5)} ${pad(r.workBudget, 6)} ${pad(num(r.cost), 11)} ${pad(pct(r.hitRate), 4)}`
            + `  ${pad(`${r.summaries}(${r.ineffectiveSummaries})`, 8)}  ${pad(`${r.foldedMsgs}(${pct(foldLoss(r))})`, 10)}`
            + ` ${pad(num(r.peakTokens), 8)} ${pad(r.avgRetainedMsgs.toFixed(1), 5)}  ${pad(rel, 9)}`,
        );
    }
}

/**
 * 1. 模拟器自检：确认 mock 环境下的行为和生产代码一致，
 *    否则后面所有结论都不可信。
 */
test("simulator sanity: summary / fold / prefix cache", async () => {
    const { ChatRecorder } = await loadCore();

    // 折叠只动 system 消息，且是幂等的（第二次没有新的可折叠内容）
    const rec = new ChatRecorder("fold-check");
    rec.add({ role: "user", content: { text: "用户消息".repeat(400) } });
    rec.add({ role: "system", content: { text: "工具痕迹".repeat(2_000) } });
    const before = rec.chars;
    assert.equal(rec.compactIfNeeded(100), 1, "超预算时应折叠 1 条工具痕迹");
    assert.ok(rec.chars < before, "折叠后体积应下降");
    assert.equal(rec.compactIfNeeded(100), 0, "已折叠的消息不应重复折叠");
    assert.equal(rec.getAll()[0].role, "user", "用户消息不应被折叠");

    // 摘要：超阈值才触发，触发后体积下降且概要非空
    const sim = new ChatSim({ chatThreshold: 2_000, workBudget: DEFAULT_WORK, rounds: 120, toolRate: 0 });
    const report = await sim.run();
    assert.equal(report.requests, 120, "无工具时每轮只发一次请求");
    assert.ok(report.summaries > 0, "小阈值应触发摘要");
    assert.ok(report.summarizedTokens > 0, "摘要应真的压掉原文");
    assert.ok(report.peakTokens <= MODEL_WINDOW_TOKENS, "模拟会话不应超窗口");

    // 前缀缓存：同一会话连续请求应大量命中，且命中价严格低于未命中价
    assert.ok(report.hitRate > 0.5, `前缀缓存命中率应 > 50%，实际 ${pct(report.hitRate)}`);
    assert.ok(PRICE.hit < PRICE.miss);
});

/**
 * 2. 聊天阈值扫描（工作阈值固定 60k，排除折叠干扰）
 *    期望：阈值越大 → 每轮要重读的上下文越长 → 成本单调上升；
 *    阈值越小 → 摘要越频繁，直到阈值小于单条工具痕迹后摘要变成无效开销。
 */
test("chat summary threshold: cost grows with the threshold", async () => {
    const base = await runSim({ chatThreshold: DEFAULT_CHAT, workBudget: DEFAULT_WORK });
    const rows = [];
    for (const chatThreshold of CHAT_GRID) {
        rows.push({ chatThreshold, workBudget: DEFAULT_WORK, ...(await runSim({ chatThreshold, workBudget: DEFAULT_WORK })) });
    }
    printRows("chat threshold sweep (work=60k)", rows, base.cost);

    // 成本单调上升：大阈值不会因为「摘要更少」而变便宜
    for (let i = 1; i < rows.length; i++) {
        assert.ok(rows[i].cost > rows[i - 1].cost, `chat ${rows[i - 1].chatThreshold} → ${rows[i].chatThreshold} 成本应上升`);
    }

    // 阈值压到 3k 以下时，单条工具痕迹就超过阈值，摘要压不动了
    const tiny = rows[0];
    assert.ok(tiny.ineffectiveSummaries > rows[rows.length - 1].ineffectiveSummaries, "小阈值应产生更多无效摘要");

    // 最优（保真 + 成本）：应显著便宜于默认，且不在网格边缘
    const faithful = rows.filter(isFaithful).sort((a, b) => a.cost - b.cost);
    assert.ok(faithful.length > 0, "网格里应存在满足保真门槛的配置");
    const best = faithful[0];
    assert.ok(best.cost <= base.cost * 0.65, `保真最优应比默认便宜 35% 以上，实际 ${pct(best.cost / base.cost)}`);
    assert.ok(best.chatThreshold > CHAT_GRID[0] && best.chatThreshold < CHAT_GRID[CHAT_GRID.length - 1], "最优点不应落在网格边缘");
    assert.ok(best.chatThreshold <= 12_000, `聊天阈值最优应明显小于默认 40000，实际 ${best.chatThreshold}`);

    // 阈值表达成「能装下多少轮原文」，方便按群活跃度换算
    console.log(
        `\n  => best chat threshold: ${best.chatThreshold} tokens `
        + `(${(best.chatThreshold / best.growthPerRound).toFixed(1)} rounds of raw input, ${num(best.cost)} vs ${num(base.cost)} default)`,
    );
});

/**
 * 3. 工作阈值扫描（聊天阈值固定为 6k）
 *    工作阈值的作用是轮内防爆：折叠免费的，但它改写早期工具痕迹会打断前缀缓存；
 *    工作阈值大于聊天阈值时，摘要总是先触发，折叠根本不介入。
 */
test("work budget: folding is only reachable below the chat threshold", async () => {
    const CHAT = 6_000;
    const rows = [];
    for (const workBudget of WORK_GRID) {
        rows.push({ chatThreshold: CHAT, workBudget, ...(await runSim({ chatThreshold: CHAT, workBudget })) });
    }
    printRows(`work budget sweep (chat=6k)`, rows);

    // 工作阈值越小，折叠越多、丢失越多、但成本越低（折叠是纯内存操作，摘要才花钱）
    for (let i = 1; i < rows.length; i++) {
        assert.ok(rows[i].foldedMsgs <= rows[i - 1].foldedMsgs, "工作阈值放大时折叠次数应不增");
    }
    assert.ok(rows[0].foldedMsgs > 0, "极小工作阈值应触发折叠");
    assert.ok(rows[rows.length - 1].foldedMsgs === 0, "工作阈值远大于聊天阈值时不应折叠");

    const cheapest = rows.reduce((a, b) => (b.cost < a.cost ? b : a));
    assert.ok(cheapest.workBudget < CHAT, "纯成本最优的工作阈值会低于聊天阈值（靠截断省摘要钱）");
    assert.ok(foldLoss(cheapest) > FIDELITY.maxFoldLoss, "但这个最优配置的折叠丢失率应超出保真门槛");

    const faithful = rows.filter(isFaithful).sort((a, b) => a.cost - b.cost);
    assert.ok(faithful.length > 0, "应存在满足保真门槛的工作阈值");
    const best = faithful[0];
    assert.ok(best.workBudget >= CHAT, `保真最优的工作阈值应不小于聊天阈值，实际 ${best.workBudget}`);
    assert.ok(best.workBudget <= CHAT * 3, `工作阈值不必再往大放，实际最优 ${best.workBudget}`);

    console.log(`\n  => best work budget: ${best.workBudget} tokens (chat=6k, folding loss ${pct(foldLoss(best))})`);
});

/** 4. 二维网格：两个阈值会互相干扰，必须联合搜索 */
test("joint sweep: the best pair vs the default pair", async () => {
    const rows = await sweep(CHAT_GRID, WORK_GRID);
    const base = rows.find((r) => r.chatThreshold === DEFAULT_CHAT && r.workBudget === DEFAULT_WORK);
    assert.ok(base, "网格应包含默认组合");

    const cheapest = rows.reduce((a, b) => (b.cost < a.cost ? b : a));
    const faithful = rows.filter(isFaithful).sort((a, b) => a.cost - b.cost);
    const best = faithful[0];
    const candidate = await runSim({ ...CANDIDATE });

    console.log(`\n  default          : ${describe(base)}`);
    console.log(`  cheapest overall : ${describe(cheapest, base.cost)}`);
    console.log(`  cheapest faithful: ${describe(best, base.cost)}`);
    console.log(`  candidate        : ${describe({ ...candidate, ...CANDIDATE }, base.cost)}`);

    assert.ok(!cheapest.overWindow && !best.overWindow, "推荐配置不应超窗口");
    assert.ok(best.cost <= base.cost * 0.65, `联合最优应比默认便宜 35% 以上，实际 ${pct(best.cost / base.cost)}`);
    assert.ok(best.chatThreshold < DEFAULT_CHAT, "最优聊天阈值应小于默认值");
    assert.ok(best.workBudget < DEFAULT_WORK, "最优工作阈值应小于默认值");
    assert.ok(best.workBudget >= best.chatThreshold, "最优工作阈值不应低于聊天阈值，否则工具输出会被无条件截断");
    assert.ok(candidate.cost < base.cost, `候选组合不应比默认更贵，实际 ${pct(candidate.cost / base.cost)}`);
});

/**
 * 5. 负载敏感性：推荐值必须换场景也不吃亏
 *    四种场景分别代表：工具重、纯闲聊、缓存经常过期（群里隔很久才说话）、
 *    以及固定前缀很大（技能 + MCP 工具定义很多）。
 */
test("sensitivity: recommended pair never loses to the default", async () => {
    const scenarios = [
        { name: "tool-heavy (toolRate 0.6)", opts: { toolRate: 0.6 } },
        { name: "chat-only (toolRate 0)", opts: { toolRate: 0 } },
        { name: "cold cache (ttl 120s, gap 300s)", opts: { ttlSeconds: 120, gapSeconds: 300 } },
        // 大量 skills / MCP 工具定义会把固定前缀顶到上万 token，稀释阈值的影响
        { name: "fat system prefix (36k chars)", opts: { fixedPrefixChars: 36_000 } },
    ];

    console.log();
    for (const scenario of scenarios) {
        const base = await runSim({ ...scenario.opts, chatThreshold: DEFAULT_CHAT, workBudget: DEFAULT_WORK });
        const rec = await runSim({ ...scenario.opts, ...CANDIDATE });
        const ratio = rec.cost / base.cost;
        console.log(
            `  ${scenario.name.padEnd(32)} default=${num(base.cost).padStart(9)} `
            + `recommended=${num(rec.cost).padStart(9)} (${pct(ratio)})  hit ${pct(base.hitRate)} -> ${pct(rec.hitRate)}`,
        );

        assert.ok(!rec.overWindow, `${scenario.name}: 推荐配置不应超窗口`);
        assert.ok(ratio <= 1, `${scenario.name}: 推荐值不应比默认更贵，实际 ${pct(ratio)}`);
        if (scenario.opts.ttlSeconds) {
            assert.ok(ratio <= 0.5, `${scenario.name}: 缓存易过期时推荐值应省一半以上，实际 ${pct(ratio)}`);
        }
    }
});
