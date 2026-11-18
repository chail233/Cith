import OpenAI from "openai";
import config from "../config.js";
import logger from "../utils/logger.js";
import type { LlmMessage, LlmResponseMessage, LlmResult, LlmUsage, ToolDefinition } from "./types.ts";
import { recordUsage } from "../services/token-usage.ts";

export type LlmMode = "chat" | "vision" | "guard";

export interface CallLlmOptions {
    model: string;
    messages: LlmMessage[];
    temperature?: number;
    responseFormat?: { type: "json_object" | "text" };
    tools?: ToolDefinition[];
    signal?: AbortSignal;
    mode?: LlmMode;
}


const clients = new Map<string, OpenAI>();

function resolveEndpoint(mode: LlmMode): { url: string; apiKey: string } {
    switch (mode) {
        case "vision":
            return { url: config.llmVisionApiUrl, apiKey: config.visionApiKey };
        case "guard":
            return { url: config.guardApiUrl || config.llmApiUrl, apiKey: config.guardApiKey || config.aiApiKey };
        default:
            return { url: config.llmApiUrl, apiKey: config.aiApiKey };
    }
}

/** 把配置里的完整 endpoint 地址归一化为 SDK 需要的 baseURL（去掉尾部 /chat/completions 与多余斜杠） */
function normalizeBaseURL(url: string): string {
    return url.replace(/\/chat\/completions\/?$/, "").replace(/\/+$/, "");
}

function getClient(mode: LlmMode): OpenAI {
    const { url, apiKey } = resolveEndpoint(mode);
    const baseURL = normalizeBaseURL(url);
    const cacheKey = `${baseURL}|${apiKey}`;
    let client = clients.get(cacheKey);
    if (!client) {
        client = new OpenAI({ baseURL, apiKey, timeout: config.llmTimeout });
        clients.set(cacheKey, client);
    }
    return client;
}

function buildRequestBody({ model, messages, temperature, responseFormat, tools }: CallLlmOptions) {
    return {
        model,
        messages: messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[],
        ...(temperature !== undefined && { temperature }),
        ...(responseFormat && { response_format: responseFormat }),
        ...(tools && { tools: tools as unknown as OpenAI.Chat.ChatCompletionTool[] }),
    };
}

function normalizeUsage(model: string, u: OpenAI.Chat.ChatCompletion["usage"]): LlmUsage | null {
    if (!u) return null;
    const inputTokens = u.prompt_tokens ?? 0;
    const outputTokens = u.completion_tokens ?? 0;
    return {
        model,
        inputTokens,
        outputTokens,
        cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
        totalTokens: u.total_tokens ?? inputTokens + outputTokens,
    };
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

function toErrorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * 调用 LLM 聊天补全接口
 * @returns 成功返回 { message, usage }，失败返回错误字符串
 */
export async function callLLM(options: CallLlmOptions): Promise<LlmResult | string> {
    const { signal, mode = "chat" } = options;
    try {
        const completion = await getClient(mode).chat.completions.create(buildRequestBody(options), { signal });

        const rawMessage = completion.choices[0]?.message;
        if (!rawMessage) {
            logger.error("LLM 返回格式异常:", JSON.stringify(completion));
            return "LLM 返回格式异常";
        }
        logger.debug("LLM 响应:", completion);

        // 归一化 usage 后交给统计模块统一累加（识图、摘要等链路同样覆盖）
        const usage = normalizeUsage(options.model, completion.usage);
        if (usage && usage.totalTokens > 0) recordUsage(usage);

        return { message: toLlmMessage(rawMessage), usage };
    }
    catch (err) {
        if (signal?.aborted) {
            logger.info("LLM 请求已被中断");
            return "已中断";
        }
        const detail = toErrorText(err);
        logger.error("LLM API 调用失败:", detail);
        return "LLM API 调用失败:" + detail;
    }
}
