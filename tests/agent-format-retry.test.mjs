/**
 * Agent 格式纠错重试测试
 *
 * 用模块 mock 顶掉 callLLM / 工具 / 上下文组装，验证：
 * - 首次解析失败时追加一句格式提示并重试一次
 * - 重试提示只作用于那一次请求，不写入会话历史
 * - 整轮最多重试一次，二次失败按原文降级发出，不会无限重试
 */
import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

/** 每次请求的入参（供断言） */
const calls = [];
/** 待返回的响应队列；用尽后重复最后一条 */
let responses = [];

mock.module("../core/agent/client.ts", {
    namedExports: {
        callLLM: async (opts) => {
            calls.push(opts);
            return responses.length > 1 ? responses.shift() : responses[0];
        },
    },
});
mock.module("../core/agent/tools.js", {
    namedExports: { getAllTools: () => [], callTool: async () => "" },
});
mock.module("../core/agent/skill.js", {
    namedExports: { reloadSkills: async () => {}, skills: [], forceSkills: [] },
});
mock.module("../core/agent/contextBuilder.ts", {
    namedExports: { buildMessages: () => [] },
});

const { default: Agent } = await import("../core/agent/Agent.ts");

/** 构造一个只记录写入的 ChatRecorder 替身 */
function fakeMemory() {
    return {
        added: [],
        msgWithoutChat: 0,
        tryBeginRequest: () => true,
        endRequest: () => {},
        compactIfNeeded: () => 0,
        maybeSummarize: () => false,
        add(msg) { this.added.push(msg); },
    };
}

/** 构造一条 LlmResult 响应 */
function reply(content) {
    return { message: { content }, totalTokens: 10, usage: null };
}

/** 发起一轮 run，返回捕获到的 reply 事件 */
async function runOnce(memory) {
    const agent = new Agent({ sessionId: "test", memory });
    const replies = [];
    agent.on("reply", (payload) => replies.push(payload));
    await agent.run({});
    return replies;
}

beforeEach(() => {
    calls.length = 0;
    responses = [];
});

test("首次格式错误时追加提示并重试一次", async () => {
    responses = [reply("稍等，我看一下当前目录"), reply('{"action":[{"type":"text","data":{"text":"好"}}]}')];
    const memory = fakeMemory();

    const replies = await runOnce(memory);

    assert.equal(calls.length, 2, "应当恰好重试一次");
    const retryMessages = calls[1].messages;
    assert.ok(
        retryMessages.some((m) => typeof m.content === "string" && m.content.includes("无法解析")),
        "重试请求的尾部应带格式纠正提示",
    );
    assert.equal(replies.length, 1);
    assert.deepEqual(replies[0].acts, [{ type: "text", data: { text: "好" } }]);

    // 提示是临时尾部消息，不得进入会话历史
    const leaked = memory.added.filter((m) => String(m.content?.text ?? "").includes("无法解析"));
    assert.deepEqual(leaked, []);
});

test("重试后仍失败时按原文降级发出，且不再重试", async () => {
    responses = [reply("稍等，我看一下当前目录")];
    const memory = fakeMemory();

    const replies = await runOnce(memory);

    assert.equal(calls.length, 2, "整轮最多重试一次");
    assert.equal(replies.length, 1);
    assert.deepEqual(replies[0].acts, [{ type: "text", data: { text: "稍等，我看一下当前目录" } }]);
});

test("格式合法时不触发重试", async () => {
    responses = [reply('{"action":[{"type":"text","data":{"text":"在"}}]}')];
    const memory = fakeMemory();

    const replies = await runOnce(memory);

    assert.equal(calls.length, 1);
    assert.deepEqual(replies[0].acts, [{ type: "text", data: { text: "在" } }]);
});
