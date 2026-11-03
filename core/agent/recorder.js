import config from "../config.js";
import logger from "../utils/logger.js";
import { callLLM } from "./client.ts";
import { addFacts, makeMemoryUserId } from "./long-term-memory.js";
/**
 * 对话上下文管理器（分层记忆）
 *
 * 记忆层级：
 * - 短期记忆（_messages）：全部未摘要的消息，体积由 _chars 增量维护，不再按条数裁剪
 * - 中期概括（_midSummary）：上下文超过聊天阈值时由 LLM 提取成事实清单，一行一条
 * - 事实清单：与概括同时产出，逐条写入长期记忆
 *
 * 两级 token 阈值：
 * - 工作阈值（config.contextBudgetTokens）：Agent 循环内折叠最旧的工具痕迹
 * - 聊天阈值（config.chatSummaryThresholdTokens）：一轮 Agent 结束后触发后台摘要
 */

/** 预算换算：每 token 约多少字符 */
const CHARS_PER_TOKEN = 2.5;

/** 摘要后保留的尾部原文体积比例（避免下一轮丢失即时语境） */
const KEEP_TAIL_RATIO = 0.3;

/** 概要滚动窗口：最多保留的事实条数 */
const MAX_SUMMARY_FACTS = 60;

/** 摘要提示词：把对话压缩成可脱离上下文理解的事实清单 */
const SUMMARY_PROMPT =
    "请从以下对话历史中提取值得长期记住的事实，每条事实单独一行，以「- 」开头。" +
    "事实包括讨论过的话题、角色的偏好或特征、已作出的决定或承诺等。" +
    "一条事实只讲一件事，不要把多个信息点合并成一段；每条事实必须有明确主体，" +
    "不能直接用用户来指代角色；每条事实都要能脱离上下文单独理解。" +
    "消息的 time 字段是说话时间；事实涉及时间时请写成具体日期（如「2026-10-05」），" +
    "不要保留「昨天」「下周」这类相对说法。" +
    "保持简洁，不要添加原文没有的信息。只输出事实列表，不要序号、标题或其他说明；" +
    "如果没有值得记住的内容，只输出「无」。";

/** 折叠标记：带此前缀的消息视为已折叠，不再重复截断 */
const FOLDED_TAG = "[已折叠] ";

/** 折叠后保留的头部 / 尾部字符数 */
const FOLD_HEAD = 200;
const FOLD_TAIL = 100;

/** 原文短于该长度时折叠收益太低，跳过 */
const FOLD_MIN_CHARS = 800;

/**
 * 把 LLM 返回的事实列表拆成条目
 * 兼容行首的「- 」「• 」「1. 」「1、」等标记，去重并限制条数
 * @param {string} text
 * @returns {string[]}
 */
function parseFacts(text) {
    if (typeof text !== "string") return [];
    const facts = [];
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine
            .replace(/^\s*(?:[-*•·]|\d+\s*[.、)）]|[(（]\d+[)）])\s*/, "")
            .trim();
        if (!line) continue;
        if (/^(无|暂无|没有|none)\.?$/i.test(line)) continue;
        if (!facts.includes(line)) facts.push(line);
    }
    return facts.slice(0, 30);
}

/**
 * 把一条过长的消息截断成「首 + 尾」的折叠形态
 * @param {string} text 原始文本
 * @returns {string} 折叠后文本；无需折叠或已折叠时原样返回
 */
function foldText(text) {
    if (typeof text !== "string" || text.length < FOLD_MIN_CHARS) return text;
    if (text.startsWith(FOLDED_TAG)) return text;
    const head = text.slice(0, FOLD_HEAD);
    const tail = text.slice(-FOLD_TAIL);
    return `${FOLDED_TAG}${head}…[省略 ${text.length - FOLD_HEAD - FOLD_TAIL} 字]…${tail}`;
}

export class ChatRecorder {
    /**
     * @param {string} [sessionId] 会话 ID（用于派生长期记忆实体，隔离不同群/私聊）
     */
    constructor(sessionId = "default") {
        this._messages = [];
        this._midSummary = "";
        this._sessionId = sessionId;
        /** 短期消息序列化后的累计字符数（增量维护，体积判定 O(1)） */
        this._chars = 0;
        this._summarizing = false;
        this._requesting = false;
        /** 代际号：clear() 时自增，让进行中的摘要丢弃过期结果 */
        this._epoch = 0;
    }

    msgWithoutChat = 0;

    get isRequesting() {
        return this._requesting;
    }

    get isSummarizing() {
        return this._summarizing;
    }

    /**
     * 原子地占用本会话的模型请求名额
     * 用于防止同一会话并发发起模型请求
     * @returns {boolean} 已有请求进行中时返回 false
     */
    tryBeginRequest() {
        if (this._requesting) return false;
        this._requesting = true;
        return true;
    }

    /** 释放本会话的请求名额 */
    endRequest() {
        this._requesting = false;
    }

    /** 判断一条消息是否计入消息条数：工具、系统消息不计入 */
    _isCounted(msg) {
        return msg.role !== "tool" && msg.role !== "system";
    }

    /** 当前计入条数的消息数量 */
    _counted() {
        let n = 0;
        for (const m of this._messages) {
            if (this._isCounted(m)) n++;
        }
        return n;
    }

    /** 单条消息序列化后的字符数 */
    _msgChars(msg) {
        return JSON.stringify(msg.content).length;
    }

    /**
     * 添加一条消息
     * content 统一为对象格式：{ text, ...其他字段 }
     */
    add(msg) {
        if (msg.role === "user") {
            const realText = (msg.content?.text ?? "").replace(/[\s\u3000\u200b\u200c\u200d]/g, '');
            if (realText === "") return;
        }

        this._messages.push(msg);
        this._chars += this._msgChars(msg);
    }

    /** 获取所有短期消息的副本（content 序列化为字符串） */
    getAll() {
        return this._messages.map((msg) => {
            return {role: msg.role, content: JSON.stringify(msg.content)};
        });
    }

    /** 短期消息的字符总量 */
    get chars() {
        return this._chars;
    }

    /** 短期消息的预估上下文大小（token） */
    get estimatedTokens() {
        return Math.ceil(this._chars / CHARS_PER_TOKEN);
    }

    /**
     * 工作阈值守护：超出预算时，从最旧的开始把 system 消息（工具调用痕迹）折叠成首尾摘要
     * 折叠是纯内存操作、不调模型；折到预算一半以下即停
     * @param {number} tokenBudget 工作阈值（token）
     * @returns {number} 本次折叠的消息条数
     */
    compactIfNeeded(tokenBudget) {
        const budget = tokenBudget * CHARS_PER_TOKEN;
        if (!Number.isFinite(budget) || budget <= 0) return 0;
        if (this._chars <= budget) return 0;

        const target = budget / 2;
        let folded = 0;
        for (const msg of this._messages) {
            if (this._chars <= target) break;
            if (msg.role !== "system") continue;
            const text = msg.content?.text;
            const next = foldText(text);
            if (next === text) continue;
            const before = this._msgChars(msg);
            msg.content = { ...msg.content, text: next };
            this._chars += this._msgChars(msg) - before;
            folded++;
        }
        if (folded > 0) logger.info(`上下文折叠：${folded} 条工具痕迹，剩余约 ${this._chars} 字`);
        return folded;
    }

    /** 获取中期概括文本 */
    getMidSummary() {
        return this._midSummary;
    }

    /**
     * 聊天阈值检查：一轮 Agent 结束后调用，超出阈值就在后台静默摘要
     * 不 await、不抛错，不阻塞监听器摘除与下一轮对话
     * @returns {boolean} 是否已启动后台摘要
     */
    maybeSummarize() {
        const threshold = config.chatSummaryThresholdTokens;
        if (!Number.isFinite(threshold) || threshold <= 0) return false;
        if (this._summarizing) return false;
        if (this.estimatedTokens <= threshold) return false;

        this._summarizing = true;
        void this._summarize()
            .catch((err) => logger.warn("上下文摘要失败:", err instanceof Error ? err.message : err))
            .finally(() => { this._summarizing = false; });
        return true;
    }

    /** 强制摘要（忽略聊天阈值）：手动 #compress 与会话回收前调用 */
    async compress() {
        if (this._summarizing) return;
        this._summarizing = true;
        try {
            await this._summarize();
        }
        finally {
            this._summarizing = false;
        }
    }

    /**
     * 摘要主体：把较旧的对话提取成事实清单
     * - 先快照：摘要期间新到的消息不参与本次摘要，也不会被误删
     * - 事实写入长期记忆后才更新概要并移除原文；模型调用失败时原文原样保留
     */
    async _summarize() {
        const epoch = this._epoch;
        const snapshot = this._messages.slice();
        if (snapshot.length === 0) return;

        const cut = this._keepTailIndex(snapshot);
        const older = snapshot.slice(0, cut);
        if (older.length === 0) return;

        const facts = await this._extractFacts(older);
        // 没提取到事实（模型无响应/只返回「无」）就不动原文，避免静默丢历史
        if (facts.length === 0) {
            logger.debug("上下文摘要未产出事实，保留原文");
            return;
        }

        const written = await addFacts(makeMemoryUserId(this._sessionId), facts);
        // 长期记忆已开启但一条也没写进去（存储不可用/超时）：保留原文，避免只剩概要
        if (written === 0 && config.enableLongTermMemory) {
            logger.warn("上下文摘要入库失败，保留原文");
            return;
        }
        // clear() 期间完成的摘要不再回写，避免清空后概要又凭空出现
        if (epoch !== this._epoch) return;
        const merged = [];
        for (const fact of [...parseFacts(this._midSummary), ...facts]) {
            if (!merged.includes(fact)) merged.push(fact);
        }
        this._midSummary = merged.slice(-MAX_SUMMARY_FACTS).join("\n");

        const removed = new Set(older);
        this._messages = this._messages.filter((msg) => !removed.has(msg));
        this._recount();
        logger.info(`上下文摘要：${older.length} 条消息 → ${facts.length} 条事实，剩余约 ${this._chars} 字`);
    }

    /**
     * 调 LLM 从消息里提取事实清单
     * @param {Array<{role: string, content: unknown}>} messages
     * @returns {Promise<string[]>}
     */
    async _extractFacts(messages) {
        const lines = messages.map((msg, i) => `${i + 1}.${JSON.stringify(msg).slice(0, 500)}`);
        const result = await callLLM({
            model: config.chatModel,
            messages: [
                { role: "system", content: SUMMARY_PROMPT },
                { role: "user", content: lines.join("\n") },
            ],
            temperature: 0.2,
        });
        if (typeof result === "string" || !result?.message?.content) return [];
        return parseFacts(result.message.content);
    }

    /**
     * 计算摘要切分点：尾部按体积比例保留原文，且总是给最新一条留原文
     * @param {Array<{content: unknown}>} messages 消息快照
     * @returns {number} 需摘要的前缀消息条数
     */
    _keepTailIndex(messages) {
        let total = 0;
        for (const msg of messages) total += this._msgChars(msg);

        let keepChars = total * KEEP_TAIL_RATIO;
        let index = messages.length;
        while (index > 0 && keepChars > 0) {
            keepChars -= this._msgChars(messages[--index]);
        }

        const maxCut = Math.max(messages.length - 1, 1);
        return Math.min(Math.max(index, 1), maxCut);
    }

    /** 按当前消息重算累计字符数（移除消息后调用） */
    _recount() {
        let chars = 0;
        for (const msg of this._messages) chars += this._msgChars(msg);
        this._chars = chars;
    }

    /** 清空所有记忆（短期消息与概括） */
    clear() {
        this._messages = [];
        this._midSummary = "";
        this._chars = 0;
        this.msgWithoutChat = 0;
        this._epoch++;
    }

    /** 当前计入条数的短期消息数量（工具、系统消息不计入） */
    get length() {
        return this._counted();
    }

    /** 会话 ID */
    get sessionId() {
        return this._sessionId;
    }
}
