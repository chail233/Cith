/**
 * 统一的 LLM API 客户端（OpenAI Chat Completions 协议）
 *
 * 通过 baseURL + apiKey 接入；不处理平台专属参数。
 */
import OpenAI from "openai";
import config from "../config.js";
import logger from "../utils/logger.js";
import type { LlmResponseMessage, LlmResult, ToolDefinition } from "./types.ts";

export type LlmMessage = { role: string; content?: unknown } & Record<string, unknown>;

/** callLLM 入参 */
export interface CallLlmOptions {
    /** 模型名 */
    model: string;
    /** 消息列表（OpenAI 消息格式） */
    messages: LlmMessage[];
    /** 温度 */
    temperature?: number;
    /** 响应格式，如 { type: "json_object" } */
    responseFormat?: { type: "json_object" | "text" };
    /** 工具列表（OpenAI function calling 格式） */
    tools?: ToolDefinition[];
    /** 请求模式："chat"（默认）或 "vision" */
    mode?: "chat" | "vision";
}

/** 按 (baseURL, apiKey) 缓存客户端实例；配置热更新后首次调用会按新配置重建 */
const clients = new Map<string, OpenAI>();

/**
 * 获取指定模式的 SDK 客户端
 */
function getClient(mode: "chat" | "vision"): OpenAI {
    const url = mode === "chat" ? config.LLM_API_URL : config.LLM_VISION_API_URL;
    const apiKey = mode === "chat" ? config.aiAPIKEY : config.visionAPIKEY;
    const baseURL = normalizeBaseURL(url);
    const key = `${baseURL}|${apiKey}`;
    let client = clients.get(key);
    if (!client) {
        client = new OpenAI({ baseURL, apiKey, timeout: config.LLM_TIMEOUT });
        clients.set(key, client);
    }
    return client;
}

/** 把配置里的完整 endpoint 地址归一化为 SDK 需要的 baseURL（去掉尾部 /chat/completions 与多余斜杠） */
function normalizeBaseURL(url: string): string {
    return url.replace(/\/chat\/completions\/?$/, "").replace(/\/+$/, "");
}

/**
 * 调用 LLM 聊天补全接口
 * @returns 成功返回 { message, totalTokens }，失败返回错误字符串
 */
export async function callLLM({ model, messages, temperature, responseFormat, tools, mode = "chat" }: CallLlmOptions): Promise<LlmResult | string> {
    try {
        const body = {
            model,
            messages: messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[],
            ...(temperature !== undefined && { temperature }),
            ...(responseFormat && { response_format: responseFormat }),
            ...(tools && { tools: tools as unknown as OpenAI.Chat.ChatCompletionTool[] }),
        };
        const completion = await getClient(mode).chat.completions.create(body);

        const message = completion.choices[0]?.message;
        if (!message) {
            logger.error("LLM 返回格式异常:", JSON.stringify(completion));
            return "LLM 返回格式异常";
        }

        logger.debug("LLM 响应:", completion);
        return {
            message: toLlmMessage(message),
            totalTokens: completion.usage?.total_tokens ?? 0,
        };
    }
    catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        logger.error("LLM API 调用失败:", detail);
        return "LLM API 调用失败:" + detail;
    }
}

/** SDK 返回消息 → 项目内 LlmResponseMessage */
function toLlmMessage(message: OpenAI.Chat.ChatCompletionMessage): LlmResponseMessage {
    const result: LlmResponseMessage = {};
    if (message.content) result.content = message.content;
    if (message.tool_calls) {
        result.tool_calls = message.tool_calls
            .filter((call): call is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => call.type === "function")
            .map((call) => ({
                id: call.id,
                function: { name: call.function.name, arguments: call.function.arguments },
            }));
    }
    return result;
}
