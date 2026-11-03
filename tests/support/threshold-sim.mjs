/**
 * 阈值成本模拟器（不调用真实模型）
 *
 * 直接驱动真实的 ChatRecorder（compactIfNeeded / maybeSummarize / _summarize），
 * 只把 callLLM、config、长期记忆、日志换成 mock，按下面的价目计费：
 * - 未命中输入 1.0 / token
 * - 命中输入 0.1 / token（缓存命中按 1/10 计价）
 * - 输出 4.0 / token
 *
 * 缓存按「消息级前缀匹配 + TTL 过期」模拟服务商的前缀缓存：
 * 摘要写入概要、折叠改写早期工具痕迹，都会让命中点在上下文中间中断，之后全部按全价。
 */
import { mock } from "node:test";

export const CHARS_PER_TOKEN = 2.5;
/** 每 token 相对价格；缓存命中按用户要求取 1/10 */
export const PRICE = { miss: 1, hit: 0.1, output: 4 };
/** 模型上下文窗口，超出视为真实请求会失败 */
export const MODEL_WINDOW_TOKENS = 128_000;

const CORE_URL = new URL("../../core/", import.meta.url);
const core = (path) => new URL(path, CORE_URL).href;

/** 摘要把上下文压成事实清单的固定提示词前缀，用来识别摘要调用 */
const SUMMARY_MARK = "请从以下对话历史中提取";

/** config mock：测试里直接改这个对象的属性，不会落盘到 config.json */
const configMock = {
    chatSummaryThresholdTokens: 40_000,
    enableLongTermMemory: true,
    chatModel: "sim-model",
};

/** 当前正在跑的模拟实例，供 mock 的 callLLM 回填用量 */
let current = null;

const loggerMock = { info() {}, warn() {}, debug() {}, error() {} };

/** 同一个模块只能 mock 一次，第二次注册会抛 ERR_INVALID_STATE */
let mocksInstalled = false;

/** 安装模块 mock；幂等，重复调用直接复用已注册的 mock */
function installMocks() {
    if (mocksInstalled) return;
    mocksInstalled = true;
    mock.module(core("config.js"), { defaultExport: configMock });
    mock.module(core("utils/logger.js"), { defaultExport: loggerMock });
    mock.module(core("agent/long-term-memory.js"), {
        namedExports: {
            addFacts: async (_userId, facts) => (Array.isArray(facts) ? facts.length : 0),
            makeMemoryUserId: (id) => `bench:${id}`,
        },
    });
    mock.module(core("agent/client.ts"), {
        namedExports: {
            callLLM: async ({ messages }) => {
                if (!current) throw new Error("模拟器未初始化");
                return current.handle(messages);
            },
        },
    });
}

let loaded = null;

/**
 * 加载被 mock 的 ChatRecorder 与 callLLM（mock 必须先于模块加载完成）
 * @returns {Promise<{ChatRecorder: any, callLLM: any}>}
 */
export async function loadCore() {
    installMocks();
    if (loaded) return loaded;
    const [recorderModule, clientModule] = await Promise.all([
        import(core("agent/recorder.js")),
        import(core("agent/client.ts")),
    ]);
    loaded = { ChatRecorder: recorderModule.ChatRecorder, callLLM: clientModule.callLLM };
    return loaded;
}

/** 确定性伪随机数（同一种子 → 同一段会话，配置之间可比） */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 词表拼接出接近中文群聊长度的文本（避免 repeat 生成高度可压缩的假文本） */
const WORDS = [
    "今天", "早上", "有点", "感觉", "那个", "项目", "服务器", "日志", "报错", "已经",
    "看一下", "帮我", "这个", "是不是", "因为", "配置", "改了", "还没", "重启", "好像",
    "确实", "不太", "确定", "顺便", "问一下", "昨天", "说的", "那个", "方案", "怎么",
    "现在", "应该", "可以", "先", "试试", "然后", "再看", "结果", "如果", "不行",
];

function randomText(rng, minChars, maxChars) {
    const target = minChars + Math.floor(rng() * (maxChars - minChars));
    let text = "";
    while (text.length < target) text += WORDS[Math.floor(rng() * WORDS.length)];
    return text.slice(0, target);
}

/** 模拟一次工具痕迹（读文件 / 搜索结果的真实量级），超过 800 字才会被 foldText 折叠 */
function toolTrace(rng) {
    const len = 1_200 + Math.floor(rng() * 4_800);
    return `调用了工具 read_file，参数：{"path":"core/agent/Agent.ts"}，结果：${randomText(rng, len, len)}`;
}

/** 一条消息在缓存里的「块」：内容即缓存键，token 数按仓库的 2.5 字/token 估算 */
function toBlock(msg) {
    const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
    return { key: text, tokens: Math.ceil((text.length + 16) / CHARS_PER_TOKEN) };
}

/** 前缀缓存：TTL 内按消息粒度的最长公共前缀命中 */
class PrefixCache {
    constructor(ttlSeconds) {
        this.ttl = ttlSeconds;
        this.blocks = [];
        this.stamp = Number.NEGATIVE_INFINITY;
    }

    /**
     * 计算本次请求的命中 token 数，并刷新缓存快照
     * @param {Array<{key: string, tokens: number}>} blocks 本次请求的消息块
     * @param {number} now 虚拟时间（秒）
     */
    match(blocks, now) {
        if (now - this.stamp > this.ttl) this.blocks = [];
        let hit = 0;
        const n = Math.min(blocks.length, this.blocks.length);
        for (let i = 0; i < n; i++) {
            if (this.blocks[i].key !== blocks[i].key) break;
            hit += blocks[i].tokens;
        }
        this.blocks = blocks;
        this.stamp = now;
        return hit;
    }
}

function emptyStats() {
    return {
        requests: 0,
        hitTokens: 0,
        missTokens: 0,
        outTokens: 0,
        summaryCalls: 0,
        summaryRounds: 0,
        /** 摘要后体积仍超阈值的次数：阈值小于「单条工具痕迹」时压缩根本推不动，纯浪费 */
        ineffectiveSummaries: 0,
        summarizedChars: 0,
        foldedMsgs: 0,
        /** 折叠丢掉的字符（首尾摘要之外的中间部分） */
        foldedChars: 0,
        /** 原始消息累计体积（不含任何压缩），用来算单轮增长 */
        rawTokensAdded: 0,
        /** 每轮结束时的原文消息条数采样和 */
        retainedMsgsSum: 0,
        peakTokens: 0,
        overWindow: false,
    };
}

const DEFAULTS = {
    /** 模拟多少轮对话 */
    rounds: 240,
    /** 聊天阈值（config.chatSummaryThresholdTokens） */
    chatThreshold: 40_000,
    /** 工作阈值（config.contextBudgetTokens） */
    workBudget: 60_000,
    /** 单轮触发工具链的概率 */
    toolRate: 0.3,
    /** 单轮内最多几段工具链，防止死循环 */
    maxChain: 2,
    /** 轮与轮之间的虚拟间隔（秒） */
    gapSeconds: 30,
    /** 前缀缓存 TTL（秒），超过则整段缓存失效 */
    ttlSeconds: 600,
    /** 固定前缀（系统提示词 + 技能/MCP 列表 + 工具 schema）的字符数 */
    fixedPrefixChars: 9_000,
    /** 模型单次回复的字符数 */
    replyChars: 220,
    seed: 20261103,
};

export class ChatSim {
    /** @param {Partial<typeof DEFAULTS>} opts */
    constructor(opts = {}) {
        this.opts = { ...DEFAULTS, ...opts };
        this.clock = 0;
        this.stats = emptyStats();
        this.cache = null;
    }

    /** mock 的 callLLM 入口：区分摘要调用与主请求 */
    handle(messages) {
        const blocks = messages.map(toBlock);
        const total = blocks.reduce((sum, b) => sum + b.tokens, 0);
        const head = String(messages[0]?.content ?? "");

        if (head.startsWith(SUMMARY_MARK)) return this.handleSummary(total);
        return this.handleChat(blocks, total);
    }

    /** 摘要调用：与主请求前缀完全不同，按全价计费，且不刷新主请求缓存 */
    handleSummary(inputTokens) {
        const factCount = Math.min(20, Math.max(2, Math.round(inputTokens / 900)));
        const content = Array.from({ length: factCount }, (_, i) => `- 事实${i + 1}：这是一个可脱离上下文理解的条目`).join("\n");
        const outTokens = Math.ceil(content.length / CHARS_PER_TOKEN);
        this.stats.summaryCalls++;
        this.stats.missTokens += inputTokens;
        this.stats.outTokens += outTokens;
        return { message: { content }, totalTokens: inputTokens + outTokens, usage: null };
    }

    /** 主请求：按前缀缓存计费 */
    handleChat(blocks, inputTokens) {
        const hit = this.cache.match(blocks, this.clock);
        this.stats.requests++;
        this.stats.hitTokens += hit;
        this.stats.missTokens += inputTokens - hit;
        this.stats.peakTokens = Math.max(this.stats.peakTokens, inputTokens);
        if (inputTokens > MODEL_WINDOW_TOKENS) this.stats.overWindow = true;

        const content = `{"action":[{"cmd":"text","content":"${"好".repeat(Math.round(this.opts.replyChars / 2))}"}]}`;
        const outTokens = Math.ceil(content.length / CHARS_PER_TOKEN);
        this.stats.outTokens += outTokens;
        return { message: { content }, totalTokens: inputTokens + outTokens, usage: null };
    }

    /** 复刻 contextBuilder.buildMessages 的骨架：固定前缀 → 概要 → 历史 */
    buildMessages(recorder, prefix) {
        const messages = [{ role: "system", content: prefix }];
        const midSummary = recorder.getMidSummary();
        if (midSummary) messages.push({ role: "system", content: `对话历史概要:${midSummary}` });
        return [...messages, ...recorder.getAll()];
    }

    /** 记录一条消息，同时统计原始体积（用于换算「单轮新增 token」） */
    addMessage(recorder, msg) {
        const before = recorder.chars;
        recorder.add(msg);
        this.stats.rawTokensAdded += (recorder.chars - before) / CHARS_PER_TOKEN;
    }

    /** 聊天阈值守护：与 Agent.finally 里的调用一致，只是等后台摘要跑完再继续 */
    async maybeSummarize(recorder) {
        const before = recorder.chars;
        if (!recorder.maybeSummarize()) return;
        for (let i = 0; i < 2_000 && recorder.isSummarizing; i++) {
            await new Promise((resolve) => setImmediate(resolve));
        }
        this.stats.summaryRounds++;
        this.stats.summarizedChars += Math.max(0, before - recorder.chars);
        // 摘要后仍超阈值：说明阈值已经小于单条工具痕迹，这一轮摘要付了钱但没换回体积
        if (recorder.estimatedTokens > this.opts.chatThreshold) this.stats.ineffectiveSummaries++;
    }

    /** 跑一段会话，返回成本报告 */
    async run() {
        const { ChatRecorder, callLLM } = await loadCore();
        const { rounds, chatThreshold, workBudget, toolRate, maxChain } = this.opts;

        current = this;
        configMock.chatSummaryThresholdTokens = chatThreshold;
        this.clock = 0;
        this.stats = emptyStats();
        this.cache = new PrefixCache(this.opts.ttlSeconds);

        const prefix = "系统".repeat(Math.ceil(this.opts.fixedPrefixChars / 2));
        const recorder = new ChatRecorder("bench");
        const rng = mulberry32(this.opts.seed);

        for (let round = 0; round < rounds; round++) {
            this.clock += this.opts.gapSeconds;
            this.addMessage(recorder, {
                role: "user",
                content: { name: "群友", id: "10001", time: "12:00", text: randomText(rng, 20, 160) },
            });

            let chain = 0;
            while (true) {
                // Agent 循环里每次请求前的工作阈值守护
                const beforeFold = recorder.chars;
                const folded = recorder.compactIfNeeded(workBudget);
                this.stats.foldedMsgs += folded;
                this.stats.foldedChars += Math.max(0, beforeFold - recorder.chars);
                await callLLM({ model: "sim", messages: this.buildMessages(recorder, prefix) });

                if (chain > 0 || rng() >= toolRate) break;
                const calls = 1 + Math.floor(rng() * 3);
                for (let i = 0; i < calls; i++) {
                    this.addMessage(recorder, { role: "system", content: { text: toolTrace(rng) } });
                    this.clock += 5;
                }
                chain++;
                if (chain >= maxChain) break;
            }

            this.addMessage(recorder, { role: "assistant", content: { action: [{ cmd: "text", content: "嗯嗯，我看下" }] } });
            await this.maybeSummarize(recorder);
            this.stats.retainedMsgsSum += recorder.length;
        }

        return this.report();
    }

    /** 汇总成可比较的指标 */
    report() {
        const s = this.stats;
        const inputTokens = s.hitTokens + s.missTokens;
        const cost = s.hitTokens * PRICE.hit + s.missTokens * PRICE.miss + s.outTokens * PRICE.output;
        return {
            cost,
            costPerRound: cost / this.opts.rounds,
            hitRate: inputTokens > 0 ? s.hitTokens / inputTokens : 0,
            requests: s.requests,
            summaries: s.summaryCalls,
            ineffectiveSummaries: s.ineffectiveSummaries,
            foldedMsgs: s.foldedMsgs,
            foldedChars: s.foldedChars,
            peakTokens: s.peakTokens,
            overWindow: s.overWindow,
            /** 被摘要吃掉的原文规模（token），粗略衡量信息损失 */
            summarizedTokens: Math.round(s.summarizedChars / CHARS_PER_TOKEN),
            /** 单轮新增的原始 token（会话活跃度），用来把阈值表达成「多少轮的量」 */
            growthPerRound: s.rawTokensAdded / this.opts.rounds,
            /** 每轮结束时的原文消息平均条数（含 user / assistant，不含工具痕迹） */
            avgRetainedMsgs: s.retainedMsgsSum / this.opts.rounds,
            rounds: this.opts.rounds,
        };
    }
}

/** 便捷入口：跑一次配置 */
export async function runSim(opts) {
    return new ChatSim(opts).run();
}

/** 在给定负载下扫一个阈值网格，返回全部结果 */
export async function sweep(chatGrid, workGrid, baseOpts = {}) {
    const results = [];
    for (const chatThreshold of chatGrid) {
        for (const workBudget of workGrid) {
            const report = await runSim({ ...baseOpts, chatThreshold, workBudget });
            results.push({ chatThreshold, workBudget, ...report });
        }
    }
    return results;
}
