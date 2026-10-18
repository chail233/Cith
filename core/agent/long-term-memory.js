// @ts-check

import axios from "axios";
import config from "../config.js";
import logger from "../utils/logger.js";

/**
 * 长期记忆 API 封装（阿里云百炼记忆库）
 *
 * 功能：
 * - addMemory(userId, messages) — 添加事实记忆
 * - searchMemory(userId, messages, options?) — 搜索事实记忆
 * - extractUserProfile(userId, messages) — 从对话中提取用户画像
 * - getUserProfile(userId) — 获取用户画像
 */

/** axios 实例（独立的 HTTP 客户端，指向记忆库 API） */
const http = axios.create({
    baseURL: config.MEMORY_API_BASE_URL,
    timeout: config.LLM_TIMEOUT,
    headers: {
        Authorization: `Bearer ${config.aiAPIKEY}`,
        "Content-Type": "application/json",
    },
});

/**
 * 构造记忆实体 ID
 * @param {string} id
 * @returns {string}
 */
export function makeMemoryUserId(id) {
    return `${config.MEMORY_USER_ID_PREFIX}${id}`;
}

/**
 * 添加事实记忆
 *
 * @param {string} userId 记忆实体 ID
 * @param {Array<{role: string, content: string}>} messages 对话消息列表
 * @returns {Promise<boolean>} 成功返回 true，失败返回 false
 */
export async function addMemory(userId, messages) {
    try {
        const payload = {
            user_id: userId,
            messages,
        };

        const resp = await http.post("/add", payload);
        const body = resp.data;

        if (body?.memory_nodes) {
            logger.debug(
                `长期记忆添加成功: ${body.memory_nodes.length} 条事实记忆`,
            );
            return true;
        }

        logger.warn("长期记忆添加返回格式异常:", body);
        return false;
    } catch (err) {
        const detail = err.response?.data?.message || err.message;
        logger.warn("长期记忆添加失败:", detail);
        return false;
    }
}

/**
 * 搜索事实记忆
 *
 * @param {string} userId 记忆实体 ID
 * @param {Array<{role: string, content: string}>} messages 对话消息（用作查询上下文）
 * @param {object} [options]
 * @param {number} [options.topK] 最大召回数量（默认 config 中定义）
 * @param {number} [options.minScore] 最小相似度阈值（默认 config 中定义）
 * @param {string} [options.planVersion] Pro 或 Lite
 * @returns {Promise<Array<string>>} 召回的记忆内容数组，为空表示无相关记忆
 */
export async function searchMemory(userId, messages, options = {}) {
    const {
        topK = config.MEMORY_SEARCH_TOP_K,
        minScore = config.MEMORY_MIN_SCORE,
        planVersion = "Pro",
    } = options;

    try {
        const payload = {
            user_id: userId,
            messages,
            top_k: topK,
            min_score: minScore,
            plan_version: planVersion,
            enable_rewrite: true,
        };

        const resp = await http.post("/memory_nodes/search", payload);
        const body = resp.data;

        if (!body?.memory_nodes?.length) {
            return [];
        }

        // 按相似度排序并过滤，提取内容
        return body.memory_nodes
            .filter((node) => (node.score ?? 1) >= minScore)
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
            .map((node) => node.content)
            .filter(Boolean);
    }
    catch (err) {
        const detail = err.response?.data?.message || err.message;
        logger.warn("长期记忆搜索失败:", detail);
        return [];
    }
}


/**
 * 从对话中提取用户画像
 *
 * 调用 /add 接口并传入 profile_schema
 * 每个用户应使用独立的 user_id，以便分别维护画像。
 *
 * @param {string} userId 用户唯一标识
 * @param {Array<{role: string, content: string}>} messages 该用户的对话消息列表
 * @returns {Promise<boolean>} 成功返回 true，失败返回 false
 */
export async function extractUserProfile(userId, messages) {
    try {
        const payload = {
            user_id: userId,
            messages,
            profile_schema: config.MEMORY_PROFILE_SCHEMA_ID,
            extract_mode:"profile_only"
        };

        const resp = await http.post("/add", payload);
        const body = resp.data;

        if (body?.memory_nodes) {
            logger.debug(
                `用户画像提取成功 [${userId}]: ${body.memory_nodes.length} 条画像属性`,
            );
            return true;
        }

        logger.warn("用户画像提取返回格式异常:", body);
        return false;
    }
    catch (err) {
        const detail = err.response?.data?.message || err.message;
        logger.warn("用户画像提取失败:", detail);
        return false;
    }
}

/**
 * 获取用户画像
 *
 * @param {string} userId 用户唯一标识
 * @returns {Promise<string>} 画像内容文本，无画像时返回空字符串
 */
export async function getUserProfile(userId) {
    try {
        const resp = await http.get(
            `/profile_schemas/${config.MEMORY_PROFILE_SCHEMA_ID}/user_profile`,
            { params: { user_id: userId } },
        );
        const body = resp.data;

        if (!body?.profile) {
            return "";
        }

        // profile 可能是对象或字符串，统一转为可读文本
        if (typeof body.profile === "string") {
            return body.profile;
        }

        return JSON.stringify(body.profile);
    }
    catch (err) {
        const detail = err.response?.data?.message || err.message;
        logger.warn("获取用户画像失败:", detail);
        return "";
    }
}