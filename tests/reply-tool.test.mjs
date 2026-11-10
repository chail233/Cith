/**
 * 适配器发言工具测试
 *
 * 覆盖三件事：
 * - 工具 schema 由各适配器自己的能力集生成：OneBot 有 mention/reply，微信没有，两边互不影响
 * - Agent 见到发言工具调用即视为「本轮回复」，直接产出消息段，不写工具痕迹、不回填结果
 * - 参数不合法时把原因回填给模型；工具链打满后的收敛请求只带发言工具
 */
import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import { buildReplyTool, REPLY_TOOL_NAME } from "../core/bot/adapters/reply-tool.ts";
import { imageCap, textCap } from "../core/bot/adapters/reply-segment-caps.ts";
import OnebotAdapter from "../core/bot/adapters/OnebotAdapter.ts";
import WechatBotAdapter from "../core/bot/adapters/WechatBotAdapter.ts";
import config from "../core/config.js";

// ---------------------------------------------------------------- 能力集

/** 工具定义里可用的消息段类型（按声明顺序） */
function segmentTypes(tool) {
    const { items } = tool.definition.function.parameters.properties.segments;
    return items.oneOf.map((item) => item.properties.type.enum[0]);
}

/** 一个不连网的空适配器替身：只用到构造参数，不会真正发送 */
const noop = async () => {};

test("OneBot 与微信的能力集各自独立", () => {
    const onebot = new OnebotAdapter(noop, { send() {} });
    const wechat = new WechatBotAdapter(noop, {});

    assert.deepEqual(segmentTypes(onebot.replyTool()), ["text", "image", "file", "mention", "reply"]);
    // 微信协议发不了 @ 和引用，模型侧根本看不到这两个段
    assert.deepEqual(segmentTypes(wechat.replyTool()), ["text", "image", "file"]);
    assert.equal(onebot.replyTool().definition.function.name, REPLY_TOOL_NAME);
    assert.equal(onebot.replyTool().kind, "reply");
});

test("发言工具部分段不合法时照发合法段", async () => {
    const tool = buildReplyTool([textCap(), imageCap()]);

    const mixed = await tool.execute({
        segments: [
            { type: "text", data: { text: "你好" } },
            { type: "mention", data: { id: "1" } },
            { type: "image", data: { media: { localPath: "core/stickers/images/S1/001.jpg" } } },
        ],
    });
    assert.deepEqual(mixed, {
        acts: [
            { type: "text", data: { text: "你好" } },
            { type: "image", data: { media: { uri: "", localPath: "core/stickers/images/S1/001.jpg" } } },
        ],
    });
});

test("一条都解析不出来时返回错误文本", async () => {
    const tool = buildReplyTool([textCap()]);

    const bad = await tool.execute({ segments: [{ type: "mention", data: { id: "1" } }] });
    assert.equal(typeof bad, "string");
    assert.match(bad, /当前通道不支持/);

    const empty = await tool.execute({ segments: [] });
    assert.match(empty, /segments/);
});

// ---------------------------------------------------------------- Agent 集成

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
    namedExports: { getAllTools: () => [], callTool: async () => "ok" },
});
mock.module("../core/agent/skill.js", {
    namedExports: { reloadSkills: async () => {}, skills: [], forceSkills: [] },
});
mock.module("../core/agent/contextBuilder.ts", {
    namedExports: { buildMessages: () => [] },
});

const { default: Agent } = await import("../core/agent/Agent.ts");

/** 只记录写入的记忆替身 */
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

/** 构造一条「调用发言工具」的模型响应 */
function replyToolCall(param, content) {
    return {
        message: {
            content,
            tool_calls: [{ id: "call_1", function: { name: REPLY_TOOL_NAME, arguments: JSON.stringify(param) } }],
        },
        totalTokens: 10,
        usage: null,
    };
}

/** 构造一条「调用普通工具」的模型响应 */
function toolCall(name) {
    return {
        message: {
            content: null,
            tool_calls: [{ id: `call_${name}`, function: { name, arguments: "{}" } }],
        },
        totalTokens: 1,
        usage: null,
    };
}

/** 当前会话的适配器替身：只有 text / image 两种能力 */
function fakeAdapter() {
    const tool = buildReplyTool([textCap(), imageCap()]);
    return { replyTool: () => tool };
}

/** 跑一轮 Agent，返回捕获到的 reply 事件 */
async function runOnce(memory) {
    const agent = new Agent({ sessionId: "test", memory });
    const replies = [];
    agent.on("reply", (payload) => replies.push(payload));
    await agent.run({ adapter: fakeAdapter() });
    return replies;
}

beforeEach(() => {
    calls.length = 0;
    responses = [];
});

test("发言工具调用即本轮回复：不写工具痕迹、不回填结果", async () => {
    // 模型在 tool_calls 前夹带的自由文本应被忽略
    responses = [replyToolCall({ segments: [{ type: "text", data: { text: "在" } }] }, "我马上说")];
    const memory = fakeMemory();

    const replies = await runOnce(memory);

    assert.equal(calls.length, 1, "发言即结束本轮，不应再请求模型");
    assert.equal(calls[0].tools[0].function.name, REPLY_TOOL_NAME, "发言工具应排在工具表首位");
    assert.deepEqual(replies[0].acts, [{ type: "text", data: { text: "在" } }]);

    const traces = memory.added.filter((m) => String(m.content?.text ?? "").includes("调用了工具"));
    assert.deepEqual(traces, [], "成功的发言不应留下工具痕迹");
    assert.ok(memory.added.some((m) => Array.isArray(m.content?.action)), "发言应写入 assistant 记忆");
});

test("发言参数不合法时回填错误并继续，下一轮正常发出", async () => {
    responses = [
        replyToolCall({ segments: [{ type: "mention", data: { id: "1" } }] }),
        replyToolCall({ segments: [{ type: "text", data: { text: "换个说法" } }] }),
    ];
    const memory = fakeMemory();

    const replies = await runOnce(memory);

    assert.equal(calls.length, 2, "参数不合法不应吞掉整轮，应回填错误让模型重来");
    assert.ok(
        memory.added.some((m) => String(m.content?.text ?? "").includes("当前通道不支持")),
        "错误原因应写回上下文",
    );
    assert.deepEqual(replies[0].acts, [{ type: "text", data: { text: "换个说法" } }]);
});

test("同一轮既有普通工具又有发言时，先跑工具再发言", async () => {
    responses = [
        {
            message: {
                content: null,
                tool_calls: [
                    { id: "a", function: { name: "run_shell", arguments: "{}" } },
                    {
                        id: "b",
                        function: {
                            name: REPLY_TOOL_NAME,
                            arguments: JSON.stringify({ segments: [{ type: "text", data: { text: "查完了" } }] }),
                        },
                    },
                ],
            },
            totalTokens: 3,
            usage: null,
        },
    ];
    const memory = fakeMemory();

    const replies = await runOnce(memory);

    assert.equal(calls.length, 1);
    assert.ok(
        memory.added.some((m) => String(m.content?.text ?? "").includes("调用了工具 run_shell")),
        "普通工具的执行痕迹照旧写回",
    );
    assert.deepEqual(replies[0].acts, [{ type: "text", data: { text: "查完了" } }]);
});

test("工具链打满后的收敛请求只带发言工具", async () => {
    const max = config.toolChainMaxLength;
    responses = [
        ...Array.from({ length: max + 1 }, () => toolCall("run_shell")),
        replyToolCall({ segments: [{ type: "text", data: { text: "收" } }] }),
    ];
    const memory = fakeMemory();

    const replies = await runOnce(memory);

    assert.equal(calls.length, max + 2, "打满后应多一次收敛请求");
    const converge = calls.at(-1);
    assert.equal(converge.tools.length, 1, "收敛请求只保留发言工具");
    assert.equal(converge.tools[0].function.name, REPLY_TOOL_NAME);
    assert.deepEqual(replies[0].acts, [{ type: "text", data: { text: "收" } }]);
});
