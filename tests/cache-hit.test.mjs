/**
 * 缓存命中链路测试（不起真实 LLM API）
 *
 * 本地起一个假 OpenAI 兼容端点，把 config 的 llmApiUrl 指过去，真实走
 * OpenAI SDK → usage 归一化 → token 用量统计的完整链路，验证两件事：
 * - 前缀缓存命中的前提：多轮请求间 messages 前缀逐字稳定，新内容只追加在尾部
 * - cached_tokens 采集：响应里的 prompt_tokens_details.cached_tokens 正确累加进统计并算出命中率
 *
 * 配置与数据根都指到临时目录，不触碰真实 config.json 与 data/。
 */
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------- 假端点

/** 记录每个请求的 messages（供前缀断言） */
const received = [];
/** 按轮编排的模型响应（用尽后重复最后一条） */
const scripted = [];

/** 组装一份 OpenAI 兼容的 ChatCompletion 响应 */
function completion(message) {
    return {
        id: `chatcmpl-${received.length}`,
        object: "chat.completion",
        created: 0,
        model: "test-model",
        choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }],
        usage: {
            prompt_tokens: 1000,
            completion_tokens: 10,
            total_tokens: 1010,
            prompt_tokens_details: { cached_tokens: 800 },
        },
    };
}

let server;
let dataRoot;
let configDir;

before(async () => {
    server = createServer((req, res) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            received.push(body.messages);
            const script = scripted[Math.min(received.length - 1, scripted.length - 1)];
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(completion(script)));
        });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;

    // 配置与数据根全部指进临时目录；阈值写 0 让摘要与笔记维护短路，不打额外请求
    // skills / prompts 播种空壳，避免目录扫描报错；system.md 会作为前缀注入上下文
    dataRoot = mkdtempSync(join(tmpdir(), "cith-cache-data-"));
    configDir = mkdtempSync(join(tmpdir(), "cith-cache-cfg-"));
    mkdirSync(join(dataRoot, "data"), { recursive: true });
    mkdirSync(join(dataRoot, "skills"), { recursive: true });
    mkdirSync(join(dataRoot, "prompts"), { recursive: true });
    writeFileSync(join(dataRoot, "prompts", "system.md"), "你是测试助手", "utf-8");
    writeFileSync(join(configDir, "config.json"), JSON.stringify({
        chatModel: "test-model",
        llmApiUrl: `http://127.0.0.1:${port}/v1/chat/completions`,
        aiApiKey: "test-key",
        chatSummaryThresholdTokens: 0,
    }), "utf-8");
    process.env.CITH_DATA = dataRoot;
    process.env.CITH_CONFIG = join(configDir, "config.json");

    // 普通工具不必真执行，固定文本结果即可；其余链路（client / 统计 / 记录器）全部真实
    mock.module("../packages/core/agent/tools.js", {
        namedExports: { getAllTools: () => [], callTool: async () => "ok" },
    });
});

after(async () => {
    server?.close();
    // 用量落盘走异步串行队列，留一小段缓冲再清理临时目录
    await new Promise((r) => setTimeout(r, 300));
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- 用例

test("多轮请求前缀稳定，cached_tokens 正确进统计", async () => {
    // 动态导入必须在环境变量设置之后：config.js 在模块加载时读取 CITH_CONFIG / CITH_DATA
    const { buildReplyTool } = await import("../packages/core/bot/adapters/reply-tool.ts");
    const { REPLY_TOOL_NAME } = await import("../packages/core/bot/adapters/reply-tool.ts");
    const { textCap, imageCap } = await import("../packages/core/bot/adapters/reply-segment-caps.ts");
    const { default: Agent } = await import("../packages/core/agent/Agent.ts");
    const { ChatRecorder } = await import("../packages/core/agent/recorder.js");
    const { getUsageSummary } = await import("../packages/core/services/token-usage.ts");

    scripted.push(
        // 第一轮：模型调用普通工具（tool_call 必须带 type: "function"，与真实响应一致）
        {
            content: null,
            tool_calls: [{ id: "c1", type: "function", function: { name: "lookup", arguments: '{"q":"天气"}' } }],
        },
        // 第二轮：工具结果回填后调用发言工具收尾
        {
            content: null,
            tool_calls: [{
                id: "c2",
                type: "function",
                function: {
                    name: REPLY_TOOL_NAME,
                    arguments: JSON.stringify({ segments: [{ type: "text", data: { text: "查好了，晴" } }] }),
                },
            }],
        },
    );

    const memory = new ChatRecorder("cache-test");
    memory.add({
        role: "user",
        content: {
            name: "测试用户",
            id: "u1",
            time: "2026-11-18 12:00:00",
            message: [{ type: "text", data: { text: "帮我查下天气" } }],
        },
    });

    const replyTool = buildReplyTool([textCap(), imageCap()]);
    const agent = new Agent({ sessionId: "test:cache", memory });
    const sent = [];
    await agent.run({
        adapter: {
            replyTool: () => replyTool,
            async sendReply(_space, acts) {
                sent.push(acts);
                return { attempts: acts.length, failures: [] };
            },
        },
    });

    // 两轮请求：轮 1 调工具、轮 2 发言收尾
    assert.equal(received.length, 2);
    const [first, second] = received;

    // 前缀稳定性：第二轮的 messages 以第一轮为前缀逐字相同（每轮上下文都是重建的，值仍须一致，前缀缓存才可能命中）
    assert.ok(second.length > first.length, "第二轮应有追加内容");
    for (let i = 0; i < first.length; i++) {
        assert.deepEqual(second[i], first[i], `第 ${i} 条消息应与上一轮逐字相同`);
    }

    // 追加发生在尾部：调用以 assistant.tool_calls 骨架回传，结果用标准 tool 角色配对
    // lookup 由测试 mock 返回固定结果 "ok"
    const tail = second.slice(first.length);
    assert.deepEqual(tail, [
        { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "lookup", arguments: '{"q":"天气"}' } }] },
        { role: "tool", tool_call_id: "c1", content: "ok" },
    ], "工具调用与结果应以标准角色字段成对回填在尾部");

    // 发言已交付
    assert.deepEqual(sent, [[{ type: "text", data: { text: "查好了，晴" } }]]);

    // cached_tokens 采集与命中率：两轮各 cached 800 / input 1000 → 累计 1600/2000 = 80%
    // recordUsage 异步落账，轮询到统计就位再断言
    let today;
    for (let i = 0; i < 80; i++) {
        ({ today } = await getUsageSummary(1));
        if (today.requests >= 2) break;
        await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(today.requests, 2);
    assert.equal(today.inputTokens, 2000);
    assert.equal(today.cachedTokens, 1600);
    assert.equal(today.outputTokens, 20);
    assert.equal(today.totalTokens, 2020);
    assert.equal(today.cacheHitRate, 80);
});
