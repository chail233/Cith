import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { setImmediate, setTimeout } from "node:timers/promises";

const config = { toolTimeout: 0 };
mock.module("../packages/core/config.js", { defaultExport: config });
mock.module("../packages/core/agent/shell-guard.ts", {
    namedExports: { checkShellCommand: async () => null },
});

let execute = async () => "测试结果";
for (const name of ["finish_turn", "run_shell"]) {
    mock.module(`../packages/core/agent/tools/${name.replaceAll("_", "-")}.ts`, {
        defaultExport: { definition: { function: { name } }, execute: () => execute() },
    });
}

const { callTool } = await import("../packages/core/agent/tools.js");
const { take } = await import("../packages/core/agent/tool-approval.ts");

const space = { channel: "desktop", from: "user", id: "desktop", conversationId: "test" };
const call = { id: "call-1", function: { name: "finish_turn", arguments: "{}" } };

function captureEvents(signal) {
    const events = [];
    const ctx = { space, signal, adapter: {
        sendToolEvent(target, event) {
            assert.equal(target, space);
            assert.equal(this, ctx.adapter);
            events.push(event);
        },
    } };
    return { events, ctx };
}

function assertExecution(events, status, output) {
    assert.deepEqual(events.map((event) => event.type), ["tool.start", "tool.end"]);
    const [start, end] = events;
    assert.equal(start.toolCallId, call.id);
    assert.ok(start.executionId);
    assert.deepEqual(end, { ...start, type: "tool.end", status, durationMs: end.durationMs, output: end.output });
    assert.match(end.output, output);
    assert.ok(end.durationMs >= 0);
}

test("并行工具各自配对开始和结束，保留原有返回语义", async () => {
    const first = captureEvents();
    const second = captureEvents();
    execute = async () => "测试结果";
    const results = await Promise.all([callTool(call, first.ctx), callTool(call, second.ctx)]);
    assert.deepEqual(results, ["finish_turn调用结果:\n测试结果", "finish_turn调用结果:\n测试结果"]);
    assertExecution(first.events, "returned", /测试结果/);
    assertExecution(second.events, "returned", /测试结果/);
    assert.notEqual(first.events[0].executionId, second.events[0].executionId);
});

test("工具抛错时报告结束并原样传播异常", async () => {
    const { ctx, events } = captureEvents();
    const failure = new Error("工具失败");
    execute = () => { throw failure; };
    await assert.rejects(callTool(call, ctx), (err) => err === failure);
    assertExecution(events, "error", /工具失败/);
});

test("超时后工具迟到的异常不会触发第二次结束", async () => {
    const { ctx, events } = captureEvents();
    const { promise, reject } = Promise.withResolvers();
    execute = () => promise;
    config.toolTimeout = 5;
    try {
        const [result] = await Promise.all([callTool(call, ctx), setTimeout(20)]);
        assert.match(result, /执行超时/);
        reject(new Error("迟到的异常"));
        await setImmediate();
        assertExecution(events, "timeout", /执行超时/);
    } finally {
        config.toolTimeout = 0;
    }
});

test("运行中被中断时报告结束，已中断的调用不启动工具", async () => {
    const controller = new AbortController();
    const { ctx, events } = captureEvents(controller.signal);
    const { promise, resolve } = Promise.withResolvers();
    execute = mock.fn(() => promise);
    const running = callTool(call, ctx);
    await setImmediate();
    controller.abort();
    assert.match(await running, /已被中断/);
    assertExecution(events, "aborted", /已被中断/);
    resolve("迟到的结果");
    assert.match(await callTool(call, ctx), /已被中断/);
    assert.equal(execute.mock.callCount(), 1);
    assertExecution(events, "aborted", /已被中断/);
});

test("参数无效和审批挂起时不发执行事件，确认后才发", async () => {
    const { ctx, events } = captureEvents();
    execute = async () => "测试结果";
    await assert.rejects(callTool({ ...call, function: { ...call.function, arguments: "{" } }, ctx), SyntaxError);
    const gated = { ...call, function: { ...call.function, name: "run_shell" } };
    const held = await callTool(gated, ctx);
    assert.equal(held.held, true);
    assert.deepEqual(events, []);
    const { entry } = take(held.id);
    assert.match(await callTool(entry.toolCall, ctx, true), /测试结果/);
    assertExecution(events, "returned", /测试结果/);
});

test("适配器投递失败或缺少可选方法时仍返回工具结果", async () => {
    execute = async () => "测试结果";
    const sendToolEvent = mock.fn((_, event) => {
        if (event.type === "tool.start") throw new Error("同步投递失败");
        return Promise.reject(new Error("异步投递失败"));
    });
    const ctx = { space, adapter: { sendToolEvent } };
    assert.match(await callTool(call, ctx), /测试结果/);
    assert.equal(sendToolEvent.mock.callCount(), 2);
    assert.match(await callTool(call, { space, adapter: {} }), /测试结果/);
    assert.match(await callTool(call), /测试结果/);
});
