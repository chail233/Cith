import config from "../config.js";
import logger from "../utils/logger.js";
import { callLLM } from "./client.ts";
import { addFacts, makeMemoryUserId } from "./long-term-memory.js";
/**
 * 对话上下文管理器（三层记忆）
 *
 * 记忆层级：
 * - 短期记忆（_messages）：最近的消息，超出 limit 则裁剪
 * - 中期缓存（_cache）：被挤出短期的消息暂存区
 * - 中期概括（_midSummary）：缓存满时由 LLM 提取成事实清单，一行一条
 * - 事实清单（_pendingFacts）：与概括同时产出，旧清单被覆盖时逐条写入长期记忆
 *
 */

/** 预算换算：每 token 约多少字符 */
const CHARS_PER_TOKEN = 2.5;

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
     * @param {number} [limit] 最大消息条数
     * @param {string} [sessionId] 会话 ID（用于派生长期记忆实体，隔离不同群/私聊）
     */
    constructor(
        limit = config.chatHistoryLimit, sessionId = "default") {
        this._messages = [];
        this._cache = [];
        this._midSummary = "";
        this._pendingFacts = [];
        this._limit = limit;
        this._sessionId = sessionId;
        this._needsSummarization = false;
        this._requesting = false;
    }

    msgWithoutChat = 0;

    get isRequesting() {
        return this._requesting;
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

    /** 释放本会话的请求名额（与 tryBeginRequest 配对，必须在 finally 中调用） */
    endRequest() {
        this._requesting = false;
    }

    /** 判断一条消息是否计入短期记忆条数：工具、系统消息不计入 */
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

    /**
     * 添加一条消息
     * content 统一为对象格式：{ text, ...其他字段 }
     * 超出短期限制的消息自动进入中期缓存
     * 计数规则：工具、系统消息不计入条数，仅 user/assistant 等消息参与裁剪
     */
    add(msg) {
        if (msg.role === "user") {
            const realText = (msg.content?.text ?? "").replace(/[\s\u3000\u200b\u200c\u200d]/g, '');
            if (realText === "") return;
        }

        this._messages.push(msg);
        while (this._counted() > this._limit) {
            const evicted = this._messages.shift();
            this._cache.push(evicted);
        }
        if (this._cache.length >= this._limit && !this._needsSummarization) {
            this._needsSummarization = true;
        }
    }

    /** 获取所有短期消息的副本（content 序列化为字符串） */
    getAll() {
        return this._messages.map((msg) => {
            return {role: msg.role, content: JSON.stringify(msg.content)};
        });
    }

    getCache() {
        return this._cache.map((msg) => {
            return {role: msg.role, content: JSON.stringify(msg.content)};
        });
    }

    /** 短期消息序列化后的字符总量 */
    _charLength() {
        let n = 0;
        for (const msg of this._messages) n += JSON.stringify(msg.content).length;
        return n;
    }

    /** 短期消息的字符总量 */
    get chars() {
        return this._charLength();
    }

    /**
     * 上下文体积守护：超出预算时，从最旧的开始把 system 消息（工具调用痕迹）折叠成首尾摘要
     * 折叠是纯内存操作、不调模型；折到预算一半以下即停
     * @param {number} tokenBudget 短期消息的 token 预算
     * @returns {number} 本次折叠的消息条数
     */
    compactIfNeeded(tokenBudget) {
        const budget = tokenBudget * CHARS_PER_TOKEN;
        if (!Number.isFinite(budget) || budget <= 0) return 0;

        let total = this._charLength();
        if (total <= budget) return 0;

        const target = budget / 2;
        let folded = 0;
        for (const msg of this._messages) {
            if (total <= target) break;
            if (msg.role !== "system") continue;
            const text = msg.content?.text;
            const next = foldText(text);
            if (next === text) continue;
            const before = JSON.stringify(msg.content).length;
            msg.content = { ...msg.content, text: next };
            total -= before - JSON.stringify(msg.content).length;
            folded++;
        }
        if (folded > 0) logger.info(`上下文折叠：${folded} 条工具痕迹，剩余约 ${total} 字`);
        return folded;
    }

    /** 获取中期概括文本 */
    getMidSummary() {
        return this._midSummary;
    }

    /**
     * 执行缓存概括
     * 异步调用 LLM 把缓存中的对话提取成事实清单。
     * 在覆盖旧清单前，会先把上一批事实逐条存入长期记忆。
     */
    async summarizeCache() {
        if (!this._needsSummarization || this._cache.length === 0) return;

        this._needsSummarization = false;

        // 1. 上一批事实还没入库：逐条写入长期记忆
        if (this._pendingFacts.length > 0) {
            const userId = makeMemoryUserId(this._sessionId);
            await addFacts(userId, this._pendingFacts);
            this._pendingFacts = [];
        }

        // 2. 生成新的事实清单
        let userMsgs = "";
        for (let i = 0; i < this._cache.length; i++) {
            const msg = this._cache[i];
            userMsgs += `${i + 1}.`;
            userMsgs += JSON.stringify(msg) + "\n";
        }
        const result = await callLLM({
            model: config.chatModel,
            messages: [
                {
                    role: "system",
                    content:
                        "请从以下对话历史中提取值得长期记住的事实，每条事实单独一行，以「- 」开头。" +
                        "事实包括讨论过的话题、角色的偏好或特征、已作出的决定或承诺等。" +
                        "一条事实只讲一件事，不要把多个信息点合并成一段；每条事实必须有明确主体，" +
                        "不能直接用用户来指代角色；每条事实都要能脱离上下文单独理解。" +
                        "保持简洁，不要添加原文没有的信息。只输出事实列表，不要序号、标题或其他说明；" +
                        "如果没有值得记住的内容，只输出「无」。",
                },
                {
                    role: "user",
                    content: userMsgs
                }
            ],
            temperature: 0.2,
        });

        if (typeof result !== "string" && result?.message?.content) {
            const facts = parseFacts(result.message.content);
            this._pendingFacts = facts;
            this._midSummary = facts.join("\n");
        }

        this._cache = [];
    }

    async compress() {
        if (this._counted() >= 10) {
            this._cache = this._cache.concat(this._messages);
            this._messages = [];
        }
        this._needsSummarization = true;
        await this.summarizeCache();
    }

    /** 清空所有记忆（短期、缓存、概括） */
    clear() {
        this._messages = [];
        this._cache = [];
        this._midSummary = "";
        this._pendingFacts = [];
        this._needsSummarization = false;
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
