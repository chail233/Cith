/**
 * 适配器发言工具测试
 *
 * 覆盖四件事：
 * - 工具 schema 由各适配器自己的能力集生成：OneBot 有 mention/reply，微信没有，两边互不影响
 * - Agent 见到发言工具调用即视为「本轮回复」：当场交付消息段，不写工具痕迹
 * - 同一轮还有其它工具时，话照发、工具照跑，跑完继续循环，直到只剩发言或没有工具
 * - 工具链打满后的收敛请求只带发言工具
 * - 发言是唯一出口：不调工具时的纯文本先纠偏重试一次，仍犯则桥接发送；没有适配器直接报错
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

    assert.deepEqual(segmentTypes(onebot.replyTool()), ["text", "image", "file", "voice", "mention", "reply"]);
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
            // 字段原样透传，不再在这一层补 uri/改名，怎么发由适配器决定
            { type: "image", data: { media: { localPath: "core/stickers/images/S1/001.jpg" } } },
        ],
    });
});

test("只按通道过滤段类型，字段原样透传", async () => {
    const tool = buildReplyTool([textCap(), imageCap()]);

    // 模型填了额外字段、空了 text、把本地路径填进 uri：一概不改不拦，留给适配器兑现或跳过
    const out = await tool.execute({
        segments: [
            { type: "text", data: { text: "", extra: 1 } },
            { type: "image", data: { media: { uri: "core/a.jpg" } } },
        ],
    });
    assert.deepEqual(out, {
        acts: [
            { type: "text", data: { text: "", extra: 1 } },
            { type: "image", data: { media: { uri: "core/a.jpg" } } },
        ],
    });
});

test("一条都解析不出来时返回错误文本", async () => {
    const tool = buildReplyTool([textCap()]);

    const bad = await tool.execute({ segments: [{ type: "mention", data: { id: "1" } }] });
    assert.equal(typeof bad, "string");
    assert.match(bad, /当前通道不支持/);

    const noParam = await tool.execute({});
    assert.equal(typeof noParam, "string");
    assert.match(noParam, /segments/);
});

test("空数组 = 明确不发言，不是参数错误", async () => {
    const tool = buildReplyTool([textCap()]);

    // schema 不再限制最小长度，否则模型无法表达「本轮不说话」
    assert.equal(tool.definition.function.parameters.properties.segments.minItems, undefined);

    assert.deepEqual(await tool.execute({ segments: [] }), { acts: [] });
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
async function runOnce(memory, ctx = { adapter: fakeAdapter() }) {
    const agent = new Agent({ sessionId: "test", memory });
    const replies = [];
    agent.on("reply", (payload) => replies.push(payload));
    await agent.run(ctx);
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

test("同一轮既有工具又有发言时，话当场发出并继续跑工具", async () => {
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
                            arguments: JSON.stringify({ segments: [{ type: "text", data: { text: "我先查一下" } }] }),
                        },
                    },
                ],
            },
            totalTokens: 3,
            usage: null,
        },
        replyToolCall({ segments: [{ type: "text", data: { text: "查完了" } }] }),
    ];
    const memory = fakeMemory();

    const replies = await runOnce(memory);

    assert.equal(calls.length, 2, "工具跑完应继续下一轮，而不是直接收尾");
    assert.ok(
        memory.added.some((m) => String(m.content?.text ?? "").includes("调用了工具 run_shell")),
        "普通工具的执行痕迹照旧写回",
    );
    // 同轮说的那句当场发出，末尾的结论再发一条，共两条
    assert.deepEqual(replies.map((r) => r.acts), [
        [{ type: "text", data: { text: "我先查一下" } }],
        [{ type: "text", data: { text: "查完了" } }],
    ]);
    const said = memory.added.filter((m) => Array.isArray(m.content?.action));
    assert.equal(said.length, 2, "两次发言都应写进记忆");
});

test("同轮发言参数不合法时工具照跑，改好后再发", async () => {
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
                            arguments: JSON.stringify({ segments: [{ type: "video", data: {} }] }),
                        },
                    },
                ],
            },
            totalTokens: 3,
            usage: null,
        },
        replyToolCall({ segments: [{ type: "text", data: { text: "查完了" } }] }),
    ];
    const memory = fakeMemory();

    const replies = await runOnce(memory);

    assert.equal(calls.length, 2, "发言失败不该中断循环");
    assert.ok(
        memory.added.some((m) => String(m.content?.text ?? "").includes("当前通道不支持")),
        "错误应回填给模型",
    );
    assert.deepEqual(replies.map((r) => r.acts), [[{ type: "text", data: { text: "查完了" } }]]);
});

test("模型传空数组时不发言：不广播 reply，但留一条记忆痕迹", async () => {
    responses = [replyToolCall({ segments: [] })];
    const memory = fakeMemory();

    const replies = await runOnce(memory);

    assert.equal(calls.length, 1, "不发言也是本轮结论，不应再请求模型");
    assert.equal(replies.length, 0, "没有内容可发，不应广播 reply 事件");
    const silent = memory.added.find((m) => Array.isArray(m.content?.action));
    assert.ok(silent, "应写入一条 assistant 痕迹");
    assert.deepEqual(silent.content.action, []);
    assert.equal(memory.msgWithoutChat, 0, "不发言不该重置主动聊天计数");
});

test("模型没调任何工具且正文为空时本轮不发言", async () => {
    responses = [{ message: { content: null }, totalTokens: 5, usage: null }];
    const memory = fakeMemory();

    const replies = await runOnce(memory);

    assert.equal(calls.length, 1, "真沉默就是本轮结论，不该再追问");
    assert.equal(replies.length, 0, "没有内容不该广播 reply 事件");
    assert.ok(memory.added.some((m) => Array.isArray(m.content?.action)), "仍应留下「本轮没说话」的记忆痕迹");
});

test("纯文本作答时先纠偏重试，改用发言工具后正常发出", async () => {
    responses = [
        { message: { content: "我觉得这个话题挺有意思的" }, totalTokens: 5, usage: null },
        replyToolCall({ segments: [{ type: "text", data: { text: "这个话题确实有意思" } }] }),
    ];
    const memory = fakeMemory();

    const replies = await runOnce(memory);

    assert.equal(calls.length, 2, "纯文本应回填纠偏后再请求一次");
    assert.ok(
        memory.added.some((m) => String(m.content?.text ?? "").includes("没有调用 send_message")),
        "纠偏原因应写回上下文",
    );
    assert.deepEqual(replies[0].acts, [{ type: "text", data: { text: "这个话题确实有意思" } }]);
});

test("纠偏后仍纯文本时桥接成文本段发出", async () => {
    responses = [
        { message: { content: "第一版答案" }, totalTokens: 5, usage: null },
        { message: { content: "第二版答案" }, totalTokens: 5, usage: null },
    ];
    const memory = fakeMemory();

    const replies = await runOnce(memory);

    assert.equal(calls.length, 2, "桥接前只纠偏一次，不再无限重试");
    assert.deepEqual(replies[0].acts, [{ type: "text", data: { text: "第二版答案" } }], "把最后一次正文当发言发出");
    assert.ok(memory.added.some((m) => Array.isArray(m.content?.action)), "桥接的发言照常写入 assistant 记忆");
});

test("收敛请求得到纯文本时直接桥接", async () => {
    const max = config.toolChainMaxLength;
    responses = [
        ...Array.from({ length: max + 1 }, () => toolCall("run_shell")),
        { message: { content: "收敛答复" }, totalTokens: 5, usage: null },
    ];
    const memory = fakeMemory();

    const replies = await runOnce(memory);

    assert.equal(calls.length, max + 2, "打满后应多一次收敛请求");
    assert.equal(calls.at(-1).tools.length, 1, "收敛请求只保留发言工具");
    assert.deepEqual(replies[0].acts, [{ type: "text", data: { text: "收敛答复" } }]);
});

test("当前通道没有发言工具时直接报错，不退回文本", async () => {
    responses = [{ message: { content: "随便说点什么" }, totalTokens: 5, usage: null }];
    const memory = fakeMemory();

    const replies = await runOnce(memory, {});

    assert.equal(calls.length, 0, "拿不到发言工具就不该请求模型");
    assert.equal(replies.length, 1);
    assert.match(replies[0].acts[0].data.text, /^ERROR:/);
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
