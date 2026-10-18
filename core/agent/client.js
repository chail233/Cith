import axios from "axios";
import config from "../config.js";
import logger from "../utils/logger.js";

/**
 * 统一的 LLM API 客户端
 */

/** axios 实例 */
const http = axios.create({
    baseURL: config.LLM_API_URL,
    timeout: config.LLM_TIMEOUT,
    headers: {
        Authorization: `Bearer ${config.aiAPIKEY}`,
        "Content-Type": "application/json",
    },
});

const http_vision = axios.create({
    baseURL: config.LLM_VISION_API_URL,
    timeout: config.LLM_TIMEOUT,
    headers: {
        Authorization: `Bearer ${config.visionAPIKEY}`,
        "Content-Type": "application/json",
    },
});

/**
 * 调用 LLM 聊天补全接口
 * @param {object} options
 * @param {string} options.model 模型名
 * @param {Array<object>} options.messages 消息列表
 * @param {number} [options.temperature] 温度
 * @param {boolean} [options.enableSearch] 是否启用联网搜索
 * @param {object} [options.responseFormat] 响应格式，如 { type: "json_object" }
 * @param {Array<object>} [options.tools] 工具列表
 * @param {string} [options.mode] 请求模式："chat"（默认）或 "vision"
 * @returns {Promise<import("../types/index.ts").LlmResult|string>}
 *   成功返回 { message, totalTokens }，失败返回错误字符串
 */
export async function callLLM({ model, messages, temperature, enableSearch, responseFormat, tools,mode = "chat"}) {
    try {
        const data = {
            model,
            messages,
            ...(temperature !== undefined && { temperature }),
            ...(enableSearch && { enable_search: true }),
            ...(responseFormat && { response_format: responseFormat }),
            ...(tools && { tools }),
        };
        let resp;
        if (mode === "chat") resp = await http.post("", data);
        else resp = await http_vision.post("", data);

        const body = resp.data;

        if (!body?.choices?.[0]?.message) {
            logger.error("LLM 返回格式异常:", JSON.stringify(body));
            return "LLM 返回格式异常";
        }

        logger.debug("LLM 响应:", body);
        return {
            message: body.choices[0].message,
            totalTokens: body.usage?.total_tokens ?? 0,
        };
    }
    catch (err) {
        const detail = err.response?.data?.error?.message || err.message;
        logger.error("LLM API 调用失败:", detail);
        return "LLM API 调用失败:"+ detail;
    }
}

