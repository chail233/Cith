/**
 * Agent 中断测试
 *
 * 覆盖四件事：
 * - 工具执行期间中断：本轮立即收尾，不再请求模型，也不投递消息
 * - 模型请求在途时中断：请求被信号打断，run() 立即返回，不等模型响应
 * - 中断信号确实经 ask() 传给了 callLLM
 * - 没有进行中的任务时 abort() 返回 false
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

import { buildReplyTool } from "../packages/core/bot/adapters/reply-tool.ts";
import { textCap } from "../packages/core/bot/adapters/reply-segment-caps.ts";

/** 模型请求次数 */
let calls = 0;
/** 每次请求收到的中断信号 */
let signals = [];
/** 工具执行时触发的动作（用来模拟「执行途中用户叫停」） */
let abortNow = () => {};
/** 为 true 时模型请求挂到收到中断才返回，模拟 SDK 的取消行为 */
let waitForAbort = false;

mock.module("../packages/core/agent/client.ts", {
    namedExports: {
        callLLM: async (opts) => {
            calls++;
            signals.push(opts.signal);
            if (waitForAbort) {
                await new Promise((resolve) => {
                    if (opts.signal?.aborted) return resolve();
                    opts.signal?.addEventListener("abort", () => resolve(), { once: true });
                });
                return "已中断";
            }
            return {
                message: { content: null, tool_calls: [{ id: "c1", function: { name: "run_shell", arguments: "{}" } }] },
                usage: null,
            };
        },
    },
});
mock.module("../packages/core/agent/tools.js", {
    namedExports: {
        getAllTools: () => [],
        callTool: async () => {
            abortNow();
            return "ok";
        },
    },
});
mock.module("../packages/core/agent/skill.js", {
    namedExports: { reloadSkills: async () => {}, skills: [], forceSkills: [] },
});

const { default: Agent } = await import("../packages/core/agent/Agent.ts");

function fakeMemory() {
    return {
        added: [],
        msgWithoutChat: 0,
        compactIfNeeded: () => 0,
        maybeSummarize: () => false,
        getMidSummary: () => "",
        getAll: () => [],
        add(msg) { this.added.push(msg); },
    };
}

const adapter = { replyTool: () => buildReplyTool([textCap()]) };

test("工具执行期间中断：本轮立即收尾，不再请求模型也不发言", async () => {
    calls = 0;
    signals = [];
    waitForAbort = false;
    const memory = fakeMemory();
    const agent = new Agent({ sessionId: "t1", memory });
    abortNow = () => agent.abort();

    const replies = [];
    agent.on("reply", (p) => replies.push(p));
    await agent.run({ adapter });

    assert.equal(calls, 1, "中断后不应再发起模型请求");
    assert.deepEqual(replies, [], "中断后不应投递任何消息");
    assert.ok(signals[0] instanceof AbortSignal, "callLLM 应收到中断信号");
    assert.ok(
        memory.added.some((m) => String(m.content?.text ?? "").includes("被用户中断")),
        "应留下中断记忆痕迹",
    );
});

test("模型请求在途时中断：立即结束，不等请求返回", async () => {
    calls = 0;
    signals = [];
    waitForAbort = true;
    const memory = fakeMemory();
    const agent = new Agent({ sessionId: "t2", memory });
    abortNow = () => {};

    const replies = [];
    agent.on("reply", (p) => replies.push(p));
    const run = agent.run({ adapter });
    // 等模型请求真正发出后再中断
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(agent.abort(), true);
    // 中断没有真正打断请求时，这里会超时失败
    await Promise.race([
        run,
        new Promise((_, reject) => setTimeout(() => reject(new Error("中断未立即生效")), 2000)),
    ]);

    assert.equal(calls, 1);
    assert.deepEqual(replies, [], "中断后不应投递任何消息");
    assert.ok(memory.added.some((m) => String(m.content?.text ?? "").includes("被用户中断")));
    waitForAbort = false;
});

test("没有进行中的任务时 abort() 返回 false", () => {
    const agent = new Agent({ sessionId: "t3", memory: fakeMemory() });
    assert.equal(agent.abort(), false);
});
