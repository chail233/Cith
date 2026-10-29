import config from "../config.js";
import logger from "../utils/logger.js";
import { enqueueMemoryWrite, getMemoryStore } from "../services/memory-store.ts";

/**
 * 长期记忆封装（rememori 嵌入式语义记忆）
 *
 * 存储单元是「一条事实」，由 recorder.js 拆条后逐条写入。
 * 不使用 tag：所有记忆共用一个检索空间，召回走向量索引（带 tag 会退化成精确扫描）。
 *
 * 功能：
 * - addMemory(userId, messages) — 写入一条事实记忆
 * - addFacts(userId, facts) — 批量写入多条事实（每条一条记忆）
 * - searchMemory(userId, messages, options?) — 按语义召回记忆
 */

/**
 * 构造记忆命名空间（后接会话 ID）
 * @param {string} id
 * @returns {string}
 */
export function makeMemoryUserId(id) {
    return `${config.memoryUserIdPrefix}${id}`;
}

/**
 * 给记忆操作套超时：Ollama 无响应时不让摘要/召回链路卡死
 * @template T
 * @param {Promise<T>} task
 * @returns {Promise<T>}
 */
async function withTimeout(task) {
    const ms = config.memoryTimeout;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    try {
        return await Promise.race([
            task,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`记忆操作超时（${ms}ms）`)), ms);
            }),
        ]);
    }
    finally {
        clearTimeout(timer);
    }
}

/**
 * 从消息内容中取出纯文本
 * content 可能是字符串、JSON 字符串或 { text } 对象；
 * 结构化消息（如 assistant 的 { action: [...] }、工具痕迹）没有用户可见文本，返回空串
 * @param {unknown} content
 * @returns {string}
 */
function messageText(content) {
    if (typeof content === "string") {
        try {
            const parsed = JSON.parse(content);
            if (parsed && typeof parsed === "object") {
                return typeof parsed.text === "string" ? parsed.text : "";
            }
        }
        catch {
            // 非 JSON，按原文处理
        }
        return content;
    }
    if (content && typeof content === "object" && typeof /** @type {{text?: unknown}} */ (content).text === "string") {
        return /** @type {{text: string}} */ (content).text;
    }
    return "";
}

/**
 * 把消息列表拼成一条待存储的文本
 * @param {Array<{role?: string, content?: unknown}>} messages
 * @returns {string}
 */
function messagesToText(messages) {
    if (!Array.isArray(messages)) return "";
    return messages
        .map((m) => messageText(m?.content).trim())
        .filter(Boolean)
        .join("\n");
}

/**
 * 添加事实记忆（一条记忆 = 一条事实）
 *
 * @param {string} userId 记忆命名空间（tag 隔离已取消，仅用于日志）
 * @param {Array<{role?: string, content?: unknown}>} messages 消息列表，其中的文本作为一条事实
 * @returns {Promise<boolean>} 成功返回 true，未启用/失败返回 false
 */
export async function addMemory(userId, messages) {
    if (!config.enableLongTermMemory) return false;
    const mem = getMemoryStore();
    if (!mem) return false;

    const text = messagesToText(messages);
    if (!text) return false;

    try {
        // 超时只放弃调用方等待：写队列仍等本次写真实结束再跑下一条，
        // 避免超时后的新写入与上一次写并发改动同一个文件
        await withTimeout(enqueueMemoryWrite(() => mem.remember(text, {
            importance: 0.8,
        })));
        logger.debug(`长期记忆写入成功[${userId}]: ${text.slice(0, 40)}`);
        return true;
    }
    catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        logger.warn("长期记忆写入失败:", detail);
        return false;
    }
}

/**
 * 批量写入事实：每条事实各存一条记忆，避免一整段概要里混着多个话题
 *
 * @param {string} userId 记忆命名空间
 * @param {string[]} facts 拆条后的单条事实
 * @returns {Promise<number>} 成功写入的条数（中途失败即停止，避免连等超时）
 */
export async function addFacts(userId, facts) {
    if (!Array.isArray(facts) || facts.length === 0) return 0;

    let written = 0;
    for (const fact of facts) {
        const text = String(fact ?? "").trim();
        if (!text) continue;
        const ok = await addMemory(userId, [{ role: "user", content: text }]);
        if (!ok) break;
        written++;
    }
    if (written > 0) logger.debug(`长期记忆批量写入 ${written} 条`);
    return written;
}

/** 一次召回的查询语句条数上限，避免模型一次塞入过多检索词 */
const MAX_QUERIES = 5;

/**
 * 归一化检索语句列表：接受字符串或字符串数组，去空、去重、限条数
 * @param {unknown} queries
 * @returns {string[]}
 */
export function normalizeQueries(queries) {
    const list = Array.isArray(queries)
        ? queries
        : (typeof queries === "string" ? [queries] : []);
    const out = [];
    for (const item of list) {
        if (typeof item !== "string") continue;
        const text = item.trim();
        if (!text || out.includes(text)) continue;
        out.push(text);
    }
    return out.slice(0, MAX_QUERIES);
}

/**
 * 从对话消息里推导查询列表：取最近几条有效文本（以用户发言为主），每条各查一次
 * @param {Array<{role?: string, content?: unknown}>} messages
 * @returns {string[]}
 */
function queriesFromMessages(messages) {
    if (!Array.isArray(messages)) return [];
    const texts = [];
    for (const msg of messages) {
        const text = messageText(msg?.content).trim();
        // 过短的（嗯/好/表情）配不出语义方向，直接跳过
        if (text.length < 4 || texts.includes(text)) continue;
        texts.push(text);
    }
    return texts.slice(-MAX_QUERIES);
}

/**
 * 搜索事实记忆
 *
 * 两种查询方式：
 * - `options.queries` 非空：按数组内每条语句各召回一次，合并去重后按相似度取前 topK
 * - `options.queries` 为空/缺省：取 messages 里最近 5 条有效文本，每条各召回一次（同样的合并策略）
 *
 * @param {string} userId 记忆命名空间（tag 隔离已取消，当前不参与检索）
 * @param {Array<{role?: string, content?: unknown}>} messages 对话消息（queries 为空时用作查询来源）
 * @param {object} [options]
 * @param {string|string[]} [options.queries] 检索语句（单条或数组）
 * @param {number} [options.topK] 合并后最多返回条数
 * @param {number} [options.minSimilarity] 原始余弦相似度底线
 * @param {number} [options.halfLifeDays] 时间衰减半衰期（天），0 表示不衰减
 * @returns {Promise<Array<string>>} 召回的记忆内容数组，为空表示无相关记忆
 */
export async function searchMemory(userId, messages, options = {}) {
    if (!config.enableLongTermMemory) return [];
    const mem = getMemoryStore();
    if (!mem) return [];

    const {
        topK = config.memorySearchTopK,
        minSimilarity = config.memoryMinSimilarity,
        halfLifeDays = config.memoryHalfLifeDays,
    } = options;

    const queries = normalizeQueries(options.queries);
    if (queries.length === 0) {
        queries.push(...queriesFromMessages(messages));
    }
    if (queries.length === 0) return [];

    // 每条语句各召回一次，任一条失败只跳过，不整体放弃
    /** @type {Map<string, number>} 记忆文本 → 最高相似度 */
    const best = new Map();
    for (const query of queries) {
        try {
            const hits = await withTimeout(mem.recall(query, {
                limit: topK,
                minSimilarity,
                halfLifeDays: halfLifeDays > 0 ? halfLifeDays : undefined,
            }));
            logger.debug(
                `长期记忆召回「${query.slice(0, 20)}」${hits.length} 条` +
                `（similarity: ${hits.map((h) => h.similarity.toFixed(3)).join(", ") || "无"}）`,
            );
            for (const hit of hits) {
                if (!hit.text) continue;
                const prev = best.get(hit.text);
                if (prev === undefined || hit.similarity > prev) best.set(hit.text, hit.similarity);
            }
        }
        catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            logger.warn(`长期记忆搜索失败「${query.slice(0, 20)}」:`, detail);
        }
    }

    return [...best.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, topK)
        .map(([text]) => text);
}
