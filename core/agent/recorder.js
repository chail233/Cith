import config from "../config.js";
import { callLLM } from "./client.js";
import { addMemory, makeMemoryUserId, extractUserProfile } from "./long-term-memory.js";
import logger from "../utils/logger.js";
/**
 * 对话上下文管理器（三层记忆）
 *
 * 记忆层级：
 * - 短期记忆（_messages）：最近的消息，超出 limit 则裁剪
 * - 中期缓存（_cache）：被挤出短期的消息暂存区
 * - 中期概括（_midSummary）：缓存满时由 LLM 概括生成
 */
export class ChatRecorder {
    /**
     * @param {number} [limit] 最大消息条数
     * @param {string} [sessionId] 会话 ID（用于派生长期记忆实体，隔离不同群/私聊）
     */
    constructor(
        limit = config.CHAT_HISTORY_LIMIT, sessionId = "default") {
        this._messages = [];
        this._cache = [];
        this._midSummary = "";
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

    /** 获取中期概括文本 */
    getMidSummary() {
        return this._midSummary;
    }

    /**
     * 执行缓存概括
     * 异步调用 LLM 概括缓存中的对话，更新中期概括文本。
     * 在覆盖旧概括前，会先将旧的概括内容存入长期记忆。
     */
    async summarizeCache() {
        if (!this._needsSummarization || this._cache.length === 0) return;

        this._needsSummarization = false;

        // 1. 如果存在旧的概括，先存入长期记忆（放在 messages 中，标注为对话摘要）
        if (this._midSummary) {
            const userId = makeMemoryUserId(this._sessionId);
            await addMemory(userId, [
                {role: "user", content: `对话摘要：${this._midSummary}`},
            ]);
        }

        // 2. 提取画像
        await this._extractProfilesFromCache();

        // 3. 生成新的概括
        let userMsgs = "";
        for (let i = 0; i < this._cache.length; i++) {
            const msg = this._cache[i];
            userMsgs += `${i + 1}.`;
            userMsgs += JSON.stringify(msg) + "\n";
        }
        const result = await callLLM({
            model: config.CHAT_MODEL,
            messages: [
                {
                    role: "system",
                    content:
                        "请用中文简要概括以下对话历史中提到的关键信息，包括讨论过的话题、角色的偏好或特征、" +
                        "已作出的决定或承诺等。保持简洁，保留最重要的事实，不要添加原文没有的信息。" +
                        "每一条描述都必须有一个主体，不能直接用用户来指代角色。" +
                        "只输出一段文本信息，不要有其他结构化信息",
                },
                {
                    role: "user",
                    content: userMsgs
                }
            ],
            temperature: 0.2,
            enableSearch: false
        });

        if (typeof result !== "string" && result?.message?.content) {
            this._midSummary = result.message.content;
        }

        this._cache = [];
    }

    /**
     * 从历史中提取画像
     */
    async _extractProfilesFromCache() {
        let userMsgs = "";
        for (let i = 0; i < this._cache.length; i++) {
            const msg = this._cache[i];
            userMsgs += `${i + 1}.`;
            userMsgs += JSON.stringify(msg) + "\n";
        }
        const result = await callLLM({
            model: config.CHAT_MODEL,
            messages: [
                {
                    role: "system",
                    content:
                        "请从以下对话历史中提取每个用户的关键信息和特征。比如家庭成员、年龄、社会关系、内容偏好、饮食习惯、年龄段、人生理想/目标、性别、爱好、居住地等\n" +
                        "返回格式必须为 JSON 对象，顶层包含一个名为 profiles 的数组字段，数组每个元素格式如下：\n" +
                        "{\"profiles\": [{\"id\": \"用户ID\", \"info\": \"提取出来的用户画像信息,用第一人称描述\"}]}\n" +
                        "请确保返回的JSON格式正确，并且只包含提取的用户信息，不要其他内容。每个用户信息只放在一个对象里。"
                },
                {
                    role: "user",
                    content: userMsgs
                }
            ],
            responseFormat: {type: "json_object"},
        });

        try {

            if (typeof result === "string" || !result?.message?.content) return;

            // json_object 模式顶层是对象，取 profiles 数组字段；兼容模型直接返回数组的情况
            const data = JSON.parse(result.message.content);
            const profiles = Array.isArray(data) ? data : data?.profiles;
            if (!Array.isArray(profiles)) {
                logger.warn("提取的画像不是数组格式:", result.message.content);
                return;
            }
            for (const profile of profiles) {
                await extractUserProfile(profile.id.toString(), [{role: "user", content: profile.info}]);
            }
        } catch (e) {
            logger.error("用户画像提取失败:", e);
        }
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
