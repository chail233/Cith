/**
 * 适配器发言工具测试
 *
 * 覆盖范围：
 * - 工具 schema 由各适配器自己的能力集生成：OneBot 有 mention/reply，微信没有，两边互不影响
 * - 发言当场直发，真实发送结果以 assistant.tool_calls + tool 消息成对回写，发言后仍可继续循环
 * - 结束工具在整批工具处理完毕后生效，支持与最终发言同批调用或单独静默结束
 * - 工具链打满后的收敛请求只带发言工具
 * - 发言是唯一出口：不调工具时的纯文本先纠偏重试一次，仍犯则桥接发送；没有适配器直接报错
 */
import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import { buildReplyTool, REPLY_TOOL_NAME } from "../packages/core/bot/adapters/reply-tool.ts";
import { imageCap, textCap } from "../packages/core/bot/adapters/reply-segment-caps.ts";
import OnebotAdapter from "../packages/core/bot/adapters/OnebotAdapter.ts";
import WechatBotAdapter from "../packages/core/bot/adapters/WechatBotAdapter.ts";
import finishTurnTool, { FINISH_TURN_TOOL_NAME } from "../packages/core/agent/tools/finish-turn.ts";
import config from "../packages/core/config.js";

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

/** 群聊 Space 替身 */
const groupSpace = { from: "group", id: "g1", channel: "onebot" };

test("OneBot 发言执行：reply/mention 攒到下一个内容段合并发送", async () => {
    const frames = [];
    const adapter = new OnebotAdapter(noop, { send: (payload) => frames.push(JSON.parse(payload)) });

    await adapter.sendReply(groupSpace, [
        { type: "reply", data: { id: "m1" } },
        { type: "mention", data: { id: "u1" } },
        { type: "text", data: { text: "收到" } },
    ]);

    assert.equal(frames.length, 1, "三段合成一条 OneBot 消息");
    assert.deepEqual(frames[0].params.message, [
        { type: "reply", data: { id: "m1" } },
        { type: "at", data: { qq: "u1" } },
        { type: "text", data: { text: "收到" } },
    ]);
});

test("OneBot 发言执行：reply 落单丢弃，mention 落单单发", async () => {
    const frames = [];
    const adapter = new OnebotAdapter(noop, { send: (payload) => frames.push(JSON.parse(payload)) });

    await adapter.sendReply(groupSpace, [
        { type: "reply", data: { id: "m1" } },
        { type: "mention", data: { id: "u1" } },
    ]);

    assert.equal(frames.length, 1);
    assert.deepEqual(frames[0].params.message, [{ type: "at", data: { qq: "u1" } }]);
});

test("发言工具部分段不合法时照发合法段", async () => {
    const tool = buildReplyTool([textCap(), imageCap()]);
    const adapter = fakeAdapter();

    const mixed = await tool.execute({
        segments: [
            { type: "text", data: { text: "你好" } },
            { type: "mention", data: { id: "1" } },
            { type: "image", data: { media: { localPath: "core/stickers/images/S1/001.jpg" } } },
        ],
    }, { adapter });
    assert.deepEqual(mixed, {
        acts: [
            { type: "text", data: { text: "你好" } },
            // 字段原样透传，不再在这一层补 uri/改名，怎么发由适配器决定
            { type: "image", data: { media: { localPath: "core/stickers/images/S1/001.jpg" } } },
        ],
        receipt: "消息已发送",
    });
    assert.deepEqual(adapter.sent, [[
        { type: "text", data: { text: "你好" } },
        { type: "image", data: { media: { localPath: "core/stickers/images/S1/001.jpg" } } },
    ]], "mention 被过滤，其余整组交给适配器执行");
});

test("只按通道过滤段类型，字段原样透传", async () => {
    const tool = buildReplyTool([textCap(), imageCap()]);

    // 模型填了额外字段、空了 text、把本地路径填进 uri：一概不改不拦，留给适配器兑现或跳过
    const out = await tool.execute({
        segments: [
            { type: "text", data: { text: "", extra: 1 } },
            { type: "image", data: { media: { uri: "core/a.jpg" } } },
        ],
    }, { adapter: fakeAdapter() });
    assert.deepEqual(out, {
        acts: [
            { type: "text", data: { text: "", extra: 1 } },
            { type: "image", data: { media: { uri: "core/a.jpg" } } },
        ],
        receipt: "消息已发送",
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

    assert.deepEqual(await tool.execute({ segments: [] }), { acts: [], receipt: "已确认本轮不发言" });
});

// ---------------------------------------------------------------- Agent 集成

/** 每次请求的入参（供断言） */
const calls = [];
/** 待返回的响应队列 */
let responses = [];

mock.module("../packages/core/agent/client.ts", {
    namedExports: {
        callLLM: async (opts) => {
            calls.push(opts);
            assert.ok(responses.length > 0, "发起了预期之外的模型请求");
            return responses.shift();
        },
    },
});
mock.module("../packages/core/agent/tools.js", {
    namedExports: {
        getAllTools: () => [finishTurnTool.definition],
        callTool: async (call) => call.function.name === FINISH_TURN_TOOL_NAME ? finishTurnTool.execute() : "ok",
    },
});
mock.module("../packages/core/agent/skill.js", {
    namedExports: { reloadSkills: async () => {}, skills: [] },
});
// 快照落盘与本测试无关，mock 成 no-op 以免写进真实数据根
mock.module("../packages/core/agent/session-store.ts", {
    namedExports: { scheduleSessionSave: () => {} },
});

const { default: Agent } = await import("../packages/core/agent/Agent.ts");

/** 只记录写入的记忆替身 */
function fakeMemory() {
    return {
        added: [],
        msgWithoutChat: 0,
        tryBeginRequest: () => true,
        endRequest: () => {},
        compactIfNeeded: () => 0,
        maybeSummarize: () => false,
        getMidSummary: () => "",
        getAll: () => [],
        snapshot: () => ({ messages: [], midSummary: "", msgWithoutChat: 0 }),
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
        usage: null,
    };
}

/** 把结束请求放在本批其他调用之前，确认处理顺序不依赖它的位置 */
function finishWith(response) {
    response.message.tool_calls.unshift(...toolCall(FINISH_TURN_TOOL_NAME).message.tool_calls);
    return response;
}

/** 当前会话的适配器替身：只有 text / image 两种能力，记录全部直发内容（发言整组段 + 桥接纯文本） */
function fakeAdapter() {
    const tool = buildReplyTool([textCap(), imageCap()]);
    const sent = [];
    return {
        replyTool: () => tool,
        sent,
        async sendReply(_space, acts) {
            sent.push(acts);
            return { attempts: acts.length, failures: [] };
        },
        async sendMsg(_space, message) { sent.push(message); },
    };
}

/** 跑一轮 Agent，返回适配器替身（含 sent 直发记录） */
async function runOnce(memory, ctx = { adapter: fakeAdapter() }) {
    const agent = new Agent({ sessionId: "test", memory });
    await agent.run(ctx);
    return ctx.adapter;
}

beforeEach(() => {
    calls.length = 0;
    responses = [];
});

test("结束工具与发言、普通工具同批调用：整批执行并写回后立即收尾", async () => {
    // 模型在 tool_calls 前夹带的自由文本应被忽略
    const response = finishWith(replyToolCall({ segments: [{ type: "text", data: { text: "在" } }] }, "我马上说"));
    response.message.tool_calls.push(...toolCall("manage_plan").message.tool_calls);
    responses = [response];
    const memory = fakeMemory();
    const adapter = fakeAdapter();

    await runOnce(memory, { adapter });

    assert.equal(calls.length, 1, "结束工具生效后不应再请求模型");
    assert.equal(calls[0].tools[0].function.name, REPLY_TOOL_NAME, "发言工具应排在工具表首位");
    assert.ok(calls[0].tools.some((tool) => tool.function.name === FINISH_TURN_TOOL_NAME));
    assert.deepEqual(adapter.sent, [[{ type: "text", data: { text: "在" } }]], "消息经适配器实际发出");

    const callIds = memory.added.flatMap((m) => m.tool_calls?.map((call) => call.id) ?? []);
    assert.deepEqual(callIds, ["call_finish_turn", "call_manage_plan", "call_1"]);
    assert.deepEqual(
        memory.added.filter((m) => m.role === "tool"),
        [
            { role: "tool", tool_call_id: "call_finish_turn", content: "已请求在当前工具批次处理完毕后结束循环" },
            { role: "tool", tool_call_id: "call_manage_plan", content: "ok" },
            { role: "tool", tool_call_id: "call_1", content: "消息已发送" },
        ],
        "每个调用都应有配对的 tool 回执",
    );
    assert.ok(memory.added.some((m) => Array.isArray(m.content?.action)), "发言应写入 assistant 记忆");
});

test("单独发言继续循环，下一批可只调用结束工具", async () => {
    const acts = [{ type: "text", data: { text: "已发送" } }];
    responses = [replyToolCall({ segments: acts }), toolCall(FINISH_TURN_TOOL_NAME)];
    const memory = fakeMemory();

    const adapter = await runOnce(memory);

    assert.equal(calls.length, 2);
    assert.deepEqual(adapter.sent, [acts]);
    assert.deepEqual(memory.added.flatMap((m) => m.content?.action ? [m.content.action] : []), [acts]);
});

test("发言参数不合法时回填错误并继续，下一轮正常发出", async () => {
    responses = [
        replyToolCall({ segments: [{ type: "mention", data: { id: "1" } }] }),
        finishWith(replyToolCall({ segments: [{ type: "text", data: { text: "换个说法" } }] })),
    ];
    const memory = fakeMemory();

    const adapter = await runOnce(memory);

    assert.equal(calls.length, 2, "参数不合法不应吞掉整轮，应回填错误让模型重来");
    assert.ok(
        memory.added.some((m) => m.role === "tool" && String(m.content).includes("当前通道不支持")),
        "错误原因应随 tool 回执写回上下文",
    );
    assert.deepEqual(adapter.sent, [[{ type: "text", data: { text: "换个说法" } }]]);
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
            usage: null,
        },
        finishWith(replyToolCall({ segments: [{ type: "text", data: { text: "查完了" } }] })),
    ];
    const memory = fakeMemory();

    const adapter = await runOnce(memory);

    assert.equal(calls.length, 2, "工具跑完应继续下一轮，而不是直接收尾");
    assert.ok(
        memory.added.some((m) => m.tool_calls?.[0]?.function.name === "run_shell"),
        "普通工具的调用骨架照旧写回",
    );
    assert.ok(
        memory.added.some((m) => m.role === "tool" && m.content === "ok"),
        "普通工具的执行结果随 tool 回执写回",
    );
    // 同轮说的那句当场发出，末尾的结论再发一条，共两条
    assert.deepEqual(adapter.sent, [
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
            usage: null,
        },
        finishWith(replyToolCall({ segments: [{ type: "text", data: { text: "查完了" } }] })),
    ];
    const memory = fakeMemory();

    const adapter = await runOnce(memory);

    assert.equal(calls.length, 2, "发言失败不该中断循环");
    assert.ok(
        memory.added.some((m) => m.role === "tool" && String(m.content).includes("当前通道不支持")),
        "错误应随 tool 回执回填给模型",
    );
    assert.deepEqual(adapter.sent, [[{ type: "text", data: { text: "查完了" } }]]);
});

test("发言工具传空数组后继续循环，单独调用结束工具可静默收尾", async () => {
    responses = [replyToolCall({ segments: [] }), toolCall(FINISH_TURN_TOOL_NAME)];
    const memory = fakeMemory();
    const adapter = fakeAdapter();

    await runOnce(memory, { adapter });

    assert.equal(calls.length, 2, "空数组表示不发消息，后续可显式结束");
    assert.equal(adapter.sent.length, 0, "空数组不应触发任何发送");
    const silent = memory.added.find((m) => Array.isArray(m.content?.action));
    assert.ok(silent, "应写入一条 assistant 痕迹");
    assert.deepEqual(silent.content.action, []);
    assert.ok(
        memory.added.some((m) => m.role === "tool" && m.content === "已确认本轮不发言"),
        "不发言的选择也应有回执",
    );
    assert.equal(memory.msgWithoutChat, 0, "不发言不该重置主动聊天计数");
});

test("模型没调任何工具且正文为空时本轮不发言", async () => {
    responses = [{ message: { content: null }, usage: null }];
    const memory = fakeMemory();

    const adapter = await runOnce(memory);

    assert.equal(calls.length, 1, "真沉默就是本轮结论，不该再追问");
    assert.equal(adapter.sent.length, 0, "没有内容不该触发发送");
    assert.ok(memory.added.some((m) => Array.isArray(m.content?.action)), "仍应留下「本轮没说话」的记忆痕迹");
});

test("纯文本作答时先纠偏重试，改用发言工具后正常发出", async () => {
    responses = [
        { message: { content: "我觉得这个话题挺有意思的" }, usage: null },
        finishWith(replyToolCall({ segments: [{ type: "text", data: { text: "这个话题确实有意思" } }] })),
    ];
    const memory = fakeMemory();

    const adapter = await runOnce(memory);

    assert.equal(calls.length, 2, "纯文本应回填纠偏后再请求一次");
    assert.ok(
        memory.added.some((m) => String(m.content?.text ?? "").includes("没有调用 send_message")),
        "纠偏原因应写回上下文",
    );
    assert.deepEqual(adapter.sent, [[{ type: "text", data: { text: "这个话题确实有意思" } }]]);
});

test("纠偏后仍纯文本时桥接成文本段发出", async () => {
    responses = [
        { message: { content: "第一版答案" }, usage: null },
        { message: { content: "第二版答案" }, usage: null },
    ];
    const memory = fakeMemory();

    const adapter = await runOnce(memory);

    assert.equal(calls.length, 2, "桥接前只纠偏一次，不再无限重试");
    assert.deepEqual(adapter.sent, ["第二版答案"], "把最后一次正文当发言发出");
    assert.ok(memory.added.some((m) => Array.isArray(m.content?.action)), "桥接的发言照常写入 assistant 记忆");
});

test("收敛请求得到纯文本时直接桥接", async () => {
    const max = config.toolChainMaxLength;
    responses = [
        ...Array.from({ length: max + 1 }, () => toolCall("run_shell")),
        { message: { content: "收敛答复" }, usage: null },
    ];
    const memory = fakeMemory();

    const adapter = await runOnce(memory);

    assert.equal(calls.length, max + 2, "打满后应多一次收敛请求");
    assert.equal(calls.at(-1).tools.length, 1, "收敛请求只保留发言工具");
    assert.deepEqual(adapter.sent, ["收敛答复"]);
});

test("当前通道没有发言工具时直接报错，不退回文本", async () => {
    responses = [{ message: { content: "随便说点什么" }, usage: null }];
    const memory = fakeMemory();

    await runOnce(memory, {});

    assert.equal(calls.length, 0, "拿不到发言工具就不该请求模型");
    const errorTrace = memory.added.find((m) => Array.isArray(m.content?.action));
    assert.ok(errorTrace, "应留一条 assistant 记忆痕迹");
    assert.match(errorTrace.content.action[0].data.text, /^ERROR:/);
});

test("工具链打满后的收敛请求只带发言工具", async () => {
    const max = config.toolChainMaxLength;
    responses = [
        ...Array.from({ length: max + 1 }, () => toolCall("run_shell")),
        replyToolCall({ segments: [{ type: "text", data: { text: "收" } }] }),
    ];
    const memory = fakeMemory();

    const adapter = await runOnce(memory);

    assert.equal(calls.length, max + 2, "打满后应多一次收敛请求");
    const converge = calls.at(-1);
    assert.equal(converge.tools.length, 1, "收敛请求只保留发言工具");
    assert.equal(converge.tools[0].function.name, REPLY_TOOL_NAME);
    assert.match(converge.messages.at(-1).content, /无需调用 finish_turn/);
    assert.deepEqual(adapter.sent, [[{ type: "text", data: { text: "收" } }]]);
});
