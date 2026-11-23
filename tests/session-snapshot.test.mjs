/**
 * 会话快照持久化测试（不起真实 LLM API）
 *
 * 本地起一个假 OpenAI 兼容端点，配置与数据根都指进临时目录，验证：
 * - 每轮 run 结束快照落盘（串行队列 + tmp/rename），含 :/# 的会话 ID 正确编码成文件名
 * - 重启模拟（会话出池 + 重新 initSessionStore）后首次使用时恢复消息、概要、计划板与用量
 * - #clear 清空短期记忆后快照文件被删除；关闭开关时不落盘
 * - 损坏或版本不符的快照文件被跳过，不阻塞启动
 */
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import finishTurnTool, { FINISH_TURN_TOOL_NAME } from "../packages/core/agent/tools/finish-turn.ts";

// ---------------------------------------------------------------- 假端点

/** 记录每个请求的 messages */
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
            prompt_tokens_details: { cached_tokens: 0 },
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
    dataRoot = mkdtempSync(join(tmpdir(), "cith-snapshot-data-"));
    configDir = mkdtempSync(join(tmpdir(), "cith-snapshot-cfg-"));
    mkdirSync(join(dataRoot, "data"), { recursive: true });
    mkdirSync(join(dataRoot, "skills"), { recursive: true });
    mkdirSync(join(dataRoot, "prompts"), { recursive: true });
    writeFileSync(join(dataRoot, "prompts", "system.md"), "你是测试助手", "utf-8");
    writeFileSync(join(configDir, "config.json"), JSON.stringify({
        chatModel: "test-model",
        llmApiUrl: `http://127.0.0.1:${port}/v1/chat/completions`,
        aiApiKey: "test-key",
        chatSummaryThresholdTokens: 0,
        enableSessionSnapshot: true,
    }), "utf-8");
    process.env.CITH_DATA = dataRoot;
    process.env.CITH_CONFIG = join(configDir, "config.json");

    // 普通工具不必真执行，固定文本结果即可
    mock.module("../packages/core/agent/tools.js", {
        namedExports: { getAllTools: () => [finishTurnTool.definition], callTool: async () => "ok" },
    });
});

after(async () => {
    server?.close();
    // 快照落盘走异步串行队列，留一小段缓冲再清理临时目录
    await new Promise((r) => setTimeout(r, 300));
    rmSync(dataRoot, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- 用例

const USER_SPACE = { from: "user", id: "u1", channel: "onebot" };
const GROUP_SPACE = { from: "group", id: "123", channel: "onebot", conversationId: "user:456" };

/** 某会话快照文件的落盘位置 */
const snapshotFile = (id) => join(dataRoot, "data", "sessions", `${encodeURIComponent(id)}.json`);

/** 组装最小可用的适配器桩 */
async function makeAdapter() {
    const { buildReplyTool } = await import("../packages/core/bot/adapters/reply-tool.ts");
    const { textCap, imageCap } = await import("../packages/core/bot/adapters/reply-segment-caps.ts");
    const sent = [];
    return {
        sent,
        replyTool: () => buildReplyTool([textCap(), imageCap()]),
        async sendReply(_space, acts) {
            sent.push(acts);
            return { attempts: acts.length, failures: [] };
        },
    };
}

test("每轮 run 结束快照落盘", async () => {
    // 动态导入必须在环境变量设置之后：config.js 在模块加载时读取 CITH_CONFIG / CITH_DATA
    const { REPLY_TOOL_NAME } = await import("../packages/core/bot/adapters/reply-tool.ts");
    const { getAgent } = await import("../packages/core/agent/AgentManager.ts");
    const { flushSessionSaves } = await import("../packages/core/agent/session-store.ts");

    scripted.push({
        content: null,
        tool_calls: [{
            id: "c1",
            type: "function",
            function: {
                name: REPLY_TOOL_NAME,
                arguments: JSON.stringify({ segments: [{ type: "text", data: { text: "你好呀" } }] }),
            },
        }, { id: "finish", type: "function", function: { name: FINISH_TURN_TOOL_NAME, arguments: "{}" } }],
    });

    const agent = getAgent(USER_SPACE);
    agent.memory.add({
        role: "user",
        content: { name: "测试用户", id: "u1", time: "2026-11-21 12:00:00", message: [{ type: "text", data: { text: "帮我查下天气" } }] },
    });
    const adapter = await makeAdapter();
    await agent.run({ adapter, space: USER_SPACE });
    await flushSessionSaves();

    const file = snapshotFile("user:u1");
    assert.ok(existsSync(file), "快照文件应已落盘");
    const saved = JSON.parse(readFileSync(file, "utf-8"));
    assert.equal(saved.version, 1);
    // 用户消息、结束和发言工具的两组调用与回执、最终发言
    assert.equal(saved.recorder.messages.length, 6);
    assert.equal(saved.recorder.messages[1].tool_calls[0].function.name, FINISH_TURN_TOOL_NAME);
    assert.equal(saved.recorder.messages[2].tool_call_id, "finish");
    assert.equal(saved.recorder.messages.at(-1).content.action[0].data.text, "你好呀");
    assert.equal(saved.usage.requests, 1);
    assert.deepEqual(adapter.sent, [[{ type: "text", data: { text: "你好呀" } }]]);
});

test("含 conversationId 的会话 ID 正确编码为文件名", async () => {
    const { getAgent } = await import("../packages/core/agent/AgentManager.ts");
    const { flushSessionSaves } = await import("../packages/core/agent/session-store.ts");

    const agent = getAgent(GROUP_SPACE);
    agent.memory.add({
        role: "user",
        content: { name: "群友", id: "456", time: "2026-11-21 12:01:00", message: [{ type: "text", data: { text: "群里聊聊" } }] },
    });
    agent.saveSnapshot();
    await flushSessionSaves();

    assert.ok(existsSync(snapshotFile("group:123#user:456")), "含 :/# 的会话 ID 应编码成合法文件名");
});

test("重启后从快照恢复会话状态", async () => {
    const { getAgent, retireSession } = await import("../packages/core/agent/AgentManager.ts");
    const { flushSessionSaves, initSessionStore } = await import("../packages/core/agent/session-store.ts");

    const agent = getAgent(USER_SPACE); // 池内命中
    agent.memory.restore({
        messages: [
            { role: "user", content: { name: "测试用户", id: "u1", time: "2026-11-21 12:00:00", message: [{ type: "text", data: { text: "第一条" } }] } },
            { role: "assistant", content: { action: [{ type: "text", data: { text: "收到" } }] } },
            { role: "user", content: { name: "测试用户", id: "u1", time: "2026-11-21 12:05:00", message: [{ type: "text", data: { text: "第二条" } }] } },
        ],
        midSummary: "测试概要",
        msgWithoutChat: 0,
    });
    agent.planBoard.set("测试目标", [{ content: "第一步", status: "in_progress" }]);
    agent.saveSnapshot();
    await flushSessionSaves();

    // 模拟重启：会话出池 + 从磁盘重新加载快照
    await retireSession("user:u1");
    await flushSessionSaves();
    await initSessionStore();

    const restored = getAgent(USER_SPACE); // 池未命中 → 从快照恢复
    assert.equal(restored.memory.sessionId, "user:u1");
    assert.equal(restored.memory.length, 3);
    assert.equal(restored.memory.getMidSummary(), "测试概要");
    const plan = restored.planBoard.render();
    assert.ok(plan?.includes("目标：测试目标"), "计划板目标应恢复");
    assert.ok(plan?.includes("→ 第一步"), "计划条目与状态图标应恢复");
    assert.equal(restored.usageStats.requests, 1, "用量计数应从快照恢复");
});

test("#clear 清空后删除快照文件", async () => {
    const { getAgent } = await import("../packages/core/agent/AgentManager.ts");
    const { flushSessionSaves } = await import("../packages/core/agent/session-store.ts");

    const agent = getAgent(GROUP_SPACE); // 池内命中
    agent.memory.clear();
    agent.saveSnapshot(); // 清空后的快照无实质内容 → 落盘时删除文件
    await flushSessionSaves();

    assert.equal(existsSync(snapshotFile("group:123#user:456")), false, "#clear 后快照文件应被删除");
});

test("关闭快照开关时不落盘", async () => {
    const config = (await import("../packages/core/config.js")).default;
    const { getAgent } = await import("../packages/core/agent/AgentManager.ts");
    const { flushSessionSaves } = await import("../packages/core/agent/session-store.ts");

    config.enableSessionSnapshot = false;
    try {
        const agent = getAgent({ from: "user", id: "u2", channel: "onebot" });
        agent.memory.add({
            role: "user",
            content: { name: "测试用户", id: "u2", time: "2026-11-21 12:02:00", message: [{ type: "text", data: { text: "开关关闭" } }] },
        });
        agent.saveSnapshot();
        await flushSessionSaves();
        assert.equal(existsSync(snapshotFile("user:u2")), false, "开关关闭时不写快照");
    }
    finally {
        config.enableSessionSnapshot = true;
    }
});

test("损坏与版本不符的快照文件被跳过", async () => {
    const { getAgent } = await import("../packages/core/agent/AgentManager.ts");
    const { initSessionStore } = await import("../packages/core/agent/session-store.ts");

    const sessionsDir = join(dataRoot, "data", "sessions");
    writeFileSync(join(sessionsDir, "broken.json"), "not-json{{{", "utf-8");
    writeFileSync(join(sessionsDir, "user%3Astale.json"), JSON.stringify({
        version: 99,
        recorder: { messages: [{ role: "user", content: {} }] },
    }), "utf-8");
    writeFileSync(join(sessionsDir, "user%3Au9.json"), JSON.stringify({
        version: 1,
        savedAt: "2026-11-21T00:00:00.000Z",
        recorder: { messages: [{ role: "user", content: { name: "u9", time: "", message: [] } }], midSummary: "", msgWithoutChat: 0 },
        plan: null,
        pendingTrigger: null,
        usage: { requests: 0, inputTokens: 0, cachedTokens: 0 },
    }), "utf-8");

    await initSessionStore();

    const restored = getAgent({ from: "user", id: "u9", channel: "onebot" });
    assert.equal(restored.memory.length, 1, "合法快照应被加载恢复");
    const skipped = getAgent({ from: "user", id: "stale", channel: "onebot" });
    assert.equal(skipped.memory.length, 0, "版本不符的快照应被跳过，得到空会话");
});
