import { callLLM } from "./client.js";
import { getRecorder } from "./session.ts";
import config from "../config.js";
import logger from "../utils/logger.js";
import {callTool, getAllTools} from "./tools.js";
import {skills, forceSkills, reloadSkills} from "./skill.js";
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

    if (!recorder.tryBeginRequest()) {
        logger.info("会话已有模型请求进行中，跳过本次请求:", recorder.sessionId);
        return;
    }
    try {
        // 触发中期记忆概括（如需）
        await recorder.summarizeCache();

        // 每回合现取：开工前重新扫描 skills 目录，保证强加载/技能列表与磁盘一致
        await reloadSkills();

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
            // 同一轮多个工具调用并行执行；失败不抛断流程，错误原因回写为 tool 消息供模型自我修正
            const toolResults = await Promise.all(
                result.message.tool_calls.map(async (tool_call) => {
                    const tool_name = tool_call.function.name;
                    let tool_args = null;
                    let tool_result = "";
                    try {
                        tool_args = JSON.parse(tool_call.function.arguments);
                        tool_result = await callTool(tool_call, ctx);
                    }
                    catch (err) {
                        logger.error("AI 工具调用失败:", tool_name, err);
                        tool_result = `工具 ${tool_name} 执行失败：${err.message}`;
                    }
                    return { tool_call, tool_name, tool_args, tool_result };
                }),
            );
            // 按 tool_calls 原顺序回填上下文，保证 tool 消息与调用一一配对
            for (const { tool_call, tool_name, tool_args, tool_result } of toolResults) {
                recorder.add({role: "system", content: { text: `调用了工具 ${tool_name}，参数：${JSON.stringify(tool_args ?? tool_call.function.arguments)}` }});
                recorder.add({ role: "tool", content: { text: tool_result }, tool_call_id: tool_call.id });
                logger.info("调用工具:", tool_name, " 参数：", tool_args, " 结果：", tool_result);
            }
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
    } finally {
        recorder.endRequest();
    }
}

function buildMessages(recorder){
    const messages = [
        { role: "system", content: SYSTEM_PROMPT },
    ];

    // 强加载技能（force: true）正文固定注入上下文，确保 100% 可达
    if (forceSkills.length > 0) {
        const forceBlock = forceSkills
            .map(s => `### ${s.name}\n${s.content}`)
            .join("\n\n");
        messages.push({ role: "system", content: `强加载技能:\n${forceBlock}` });
    }

    messages.push(
        { role: "system", content: `技能列表：${JSON.stringify(skills)}`},
        { role: "system", content: `mcp列表：${JSON.stringify(mcpClient.listServers())}`},
    );

    if (recorder.getMidSummary()) {
        messages.push({ role: "system", content: `对话历史概要:${recorder.getMidSummary()}` });
    }

    return [...messages, ...recorder.getAll()];
}

/**
 * 发送 AI 回复（支持多条消息分段发送）
 * @param {import("../../bot/adapter.js").OneBotAdapter} adapter
 * @param {import("../types/index.ts").Space} space
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
    // 存回模型应返回的 {action:[...]} 格式，与系统提示词一致，避免上下文格式漂移
    recorder.add({ role: "assistant", content: { action: res.acts } });
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