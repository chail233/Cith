import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { WebSocketServer } from "ws";
import DesktopAdapter from "../packages/core/bot/adapters/DesktopAdapter.ts";
import { BackendConnection } from "../packages/desktop/src/main/backend.ts";
import { mergeSettings } from "../packages/desktop/src/shared/settings.ts";
import { restoreSessions, snapshotOf } from "../packages/desktop/src/renderer/src/sessionSnapshot.ts";
import { applyToolFrame, groupToolTraces, markUnconfirmedTools, standaloneTrace } from "../packages/desktop/src/renderer/src/toolTraces.ts";

const space = { from: "user", id: "desktop", channel: "desktop", conversationId: "聊天" };
const first = { type: "tool.start", executionId: "exec-1", toolCallId: "call-1", toolName: "get_memory", startedAt: 1 };
const second = { ...first, executionId: "exec-2", toolCallId: "call-2", toolName: "use_tool" };

test("桌面适配器通过 WebSocket 推送开始与结束，按执行 ID 更新卡片", { timeout: 5000 }, async (t) => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    t.after(() => {
        for (const socket of server.clients) socket.terminate();
        server.close();
    });
    await once(server, "listening");

    const frames = [];
    let messages = [];
    const started = Promise.withResolvers();
    const ended = Promise.withResolvers();
    const closed = Promise.withResolvers();
    const replacement = Promise.withResolvers();
    const connection = new BackendConnection({
        onStatus(status) { if (status.state === "idle") closed.resolve(); },
        onMessage() { assert.fail("工具事件进入了聊天消息通道"); },
        onToolEvent(frame) {
            frames.push(frame);
            messages = applyToolFrame(messages, frame, "08:00");
            if (frames.length === 2) started.resolve();
            if (frames.length === 4) ended.resolve();
        },
    });
    t.after(() => connection.apply({ url: "", token: "" }));
    const peer = once(server, "connection");
    connection.apply({ url: `ws://127.0.0.1:${server.address().port}`, token: "" });
    const [ws] = await peer;
    const adapter = new DesktopAdapter(async () => {}, ws);

    ws.send(JSON.stringify({ ...first, space: { id: space.id } }));
    adapter.sendToolEvent({ ...space, channel: "onebot" }, first);
    adapter.sendToolEvent(space, { ...first, toolName: "finish_turn" });
    adapter.sendToolEvent(space, first);
    adapter.sendToolEvent(space, second);
    await started.promise;
    assert.deepEqual(frames.map((frame) => frame.space), Array(2).fill({ id: space.id, conversationId: space.conversationId }));
    assert.deepEqual(messages.map((message) => standaloneTrace(message).status), ["running", "running"]);

    // 只切换显示偏好时会重新下发现有地址和 token，进行中的工具应继续走原连接。
    server.once("connection", () => replacement.resolve(true));
    connection.apply({ url: `127.0.0.1:${server.address().port}`, token: "" });
    const reconnected = await Promise.race([replacement.promise, new Promise((resolve) => setTimeout(() => resolve(false), 500))]);
    assert.equal(reconnected, false);

    adapter.sendToolEvent(space, { ...second, type: "tool.end", status: "error", durationMs: 125, output: "运行失败" });
    adapter.sendToolEvent(space, { ...first, type: "tool.end", status: "returned", durationMs: 800, output: "结果".repeat(5_000) });
    await ended.promise;
    assert.deepEqual(messages.map((message) => message.id), ["tool:exec-1", "tool:exec-2"]);
    assert.equal(standaloneTrace(messages[0]).status, "ok");
    assert.match(standaloneTrace(messages[0]).output, /结果已截断/);
    assert.equal(standaloneTrace(messages[1]).status, "error");
    assert.equal(standaloneTrace(messages[1]).output, "运行失败");

    connection.apply({ url: "", token: "" });
    await closed.promise;
});

test("工具调用提示默认开启，已保存的关闭状态可以读回", () => {
    assert.equal(mergeSettings({}).showToolCalls, true);
    assert.equal(mergeSettings({ showToolCalls: false }).showToolCalls, false);
});

test("桌面快照恢复已有结果，未收到结果的卡片退出执行中状态", () => {
    let messages = applyToolFrame([], first, "08:00");
    const end = { ...second, type: "tool.end", status: "aborted", durationMs: 75, output: "已中断" };
    messages = applyToolFrame(messages, end, "08:00");
    // 仅收到结束帧也能展示，后续重复的开始帧不会覆盖终态。
    assert.equal(applyToolFrame(messages, second, "08:01"), messages);
    assert.equal(standaloneTrace(markUnconfirmedTools(messages)[0]).status, "unknown");
    const conversation = { id: space.conversationId, title: "测试", updated: "刚刚", messages };
    const snapshot = snapshotOf({ conversations: [conversation], archived: [], activeId: conversation.id });
    const [firstRestored, secondRestored] = restoreSessions(snapshot).conversations[0].messages;
    assert.equal(standaloneTrace(firstRestored).status, "unknown");
    assert.equal(standaloneTrace(secondRestored).output, "已中断");
    assert.equal(standaloneTrace(secondRestored).status, "aborted");
});

test("连续工具调用归为一组，与聊天消息保持原有顺序", () => {
    let messages = applyToolFrame([], first, "08:00");
    messages = applyToolFrame(messages, second, "08:00");
    const reply = { id: "reply", role: "agent", time: "08:00", segments: [{ type: "text", data: { text: "收到" } }] };
    messages = applyToolFrame([...messages, reply], { ...first, executionId: "exec-3" }, "08:01");
    messages = applyToolFrame(messages, { ...first, type: "tool.end", status: "returned", durationMs: 800, output: "结果" }, "08:01");
    const [firstGroup, middle, lastGroup] = groupToolTraces(messages);
    assert.equal(firstGroup.id, "tool:exec-1");
    assert.deepEqual(firstGroup.rows.map((row) => row.data.status), ["ok", "running"]);
    assert.deepEqual(middle, { type: "message", message: reply });
    assert.deepEqual(lastGroup.rows.map((row) => row.id), ["tool:exec-3"]);
});
