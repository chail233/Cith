import { callLLM } from "./client.js";
import { getRecorder } from "./session.ts";
import config from "../config.js";
import logger from "../utils/logger.js";
import {callTool, getAllTools} from "./tools.js";
import {skills} from "./skill.js";
import {mcpClient} from "./mcp-client.js";
import sleep from "../utils/sleep.js";

const SYSTEM_PROMPT = config.SYSTEM_PROMPT;

/**
 * AI 对话响应结构
 * @typedef {{acts: Array<{cmd: string, content: string}>, tokens: number}} ChatResult
 */

/**
 * 处理用户消息，生成 AI 回复
 * @returns {Promise<void>}
 */
export default async function chat(ctx) {
    const recorder = getRecorder(ctx.space);
    // 触发中期记忆概括（如需）
    await recorder.summarizeCache();


    let result = await callLLM({
        model: config.CHAT_MODEL,
        messages: buildMessages(recorder),
        temperature: 0.2,
        enableSearch: true,
        responseFormat: { type: "json_object" },
        tools: getAllTools(),
    });

    let tokenCount = 0;

    if (!result || typeof result === "string") {
        await sendAiReply(ctx.adapter, ctx.space, typeof result === "string" ? "ERROR:" + result : "ERROR:AI 服务无响应", recorder);
        return;
    }


    let toolDepth = 0;
    tokenCount += result.totalTokens;
    while (result?.message?.tool_calls && toolDepth <= config.TOOLCHAIN_MAX_LENGTH){
        toolDepth++;
        let parsed = handleReply(result.message.content);
        if(parsed.length > 0){
            await sendAiReply(ctx.adapter, ctx.space, {acts: parsed, tokens: tokenCount}, recorder);
            tokenCount = 0;
        }
        for(const tool_call of result.message.tool_calls){
            try {
                const tool_call_id = tool_call.id;
                const tool_name = tool_call.function.name;
                const tool_args = JSON.parse(tool_call.function.arguments);
                const tool_result = await callTool(tool_call, ctx);
                recorder.add({role: "tool", content: { text: tool_result }, tool_call_id: tool_call_id});
                logger.info("调用工具:", tool_name, " 参数：", tool_args, " 结果：", tool_result);
            }
            catch (err) {
                logger.error("AI 工具调用失败:", err);
                await sendAiReply(ctx.adapter, ctx.space, `ERROR:工具调用失败 - ${err.message}`, recorder);
            }
        }
        // chatRecorder.add({role: "system", content: { text: "工具调用已完成，请继续以JSON格式输出回复。" }});
        result = await callLLM({
            model: config.CHAT_MODEL,
            messages: buildMessages(recorder),
            temperature: 0.2,
            enableSearch: true,
            responseFormat: { type: "json_object" },
            tools: getAllTools(),
        });
        if (typeof result === "string") {
            await sendAiReply(ctx.adapter, ctx.space, "ERROR:"+result, recorder);
            return;
        }
        tokenCount += result.totalTokens;
    }

    // 解析 JSON 响应
    let parsed = handleReply(result.message.content);

    await sendAiReply(ctx.adapter, ctx.space, {
        acts: parsed??[],
        tokens: tokenCount,
    }, recorder);
}

function buildMessages(recorder){
    return [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: `技能列表：${JSON.stringify(skills)}`},
        { role: "system", content: `mcp列表：${JSON.stringify(mcpClient.listServers())}`},
        ...(recorder.getMidSummary()
            ? [{ role: "system", content: `对话历史概要：${recorder.getMidSummary()}` }]
            : []),
        ...recorder.getAll(),
    ];
}

/**
 * 发送 AI 回复（支持多条消息分段发送）
 * @param {import("../../bot/adapter.js").OneBotAdapter} adapter
 * @param {import("../pipeline/type.ts").Space} space
 * @param {{acts: Array<{cmd: string, content: string}>, tokens: number}|string} res
 * @param {import("./recorder.js").ChatRecorder} recorder 当前会话的记忆记录器
 */
export async function sendAiReply(adapter, space, res, recorder) {
    let first = true;
    if(typeof res === "string"){
        res = {acts: [{cmd: "text", content: res}], tokens: 0};
    }
    logger.info("AI 消息内容:", JSON.stringify(res));
    for (const act of res.acts) {
        if (act.cmd === "text") {
            let content = act.content;
            if(content.trim() === "") continue;
            if (first) {
                first = false;
                if(res.tokens)content += `(${res.tokens}tokens)`;
            }
            adapter.sendMsg(space, content);
        }
        await sleep(3000 + Math.floor(Math.random() * 1000));
    }
    recorder.add({ role: "assistant", content: res.acts });
    recorder.msgWithoutChat = 0
}

/**
 * 处理 AI 回复
 * 支持三种格式：
 *   1. {action: [...]}  — 预期的标准格式
 *   2. [...]            — AI 直接返回数组
 *   3. 纯文本           — 降级为 text 消息
 * @param {string|null} content
 * @returns {Array<{cmd: string, content: string}>}
 */
function handleReply(content){
    if(!content || content.trim() === "") return [];
    let parsed;
    try {
        parsed = JSON.parse(content);
    }
    catch (err) {
        logger.error("AI 返回非 JSON 格式:", content);
        return [{cmd: "text", content: content}];
    }

    // 标准格式：{action: [...]}
    if(parsed && Array.isArray(parsed.action)){
        return parsed.action;
    }
    // AI 直接返回数组：[{cmd, content}, ...]
    if(Array.isArray(parsed)){
        return parsed;
    }
    // JSON 对象但没有 action 字段，降级为文本
    logger.warn("AI 返回 JSON 但格式不匹配:", content);
    return [{cmd: "text", content: content}];
}