/**
 * 扩展工具注册表纯逻辑：搜索排序/截断、来源降级、执行截断与未找到
 * 不测 MCP provider 本体（依赖外部 server 连接），用替身 provider
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ExtensionRegistry, SEARCH_LIMIT, MAX_OUTPUT_CHARS } from "../packages/core/agent/extensions/registry.ts";

/** 构造替身来源：工具卡固定，可注入行为异常 */
function fakeProvider(id, tools = [], opts = {}) {
    const calls = { search: 0 };
    return {
        id,
        init: async () => { if (opts.failInit) throw new Error("init boom"); },
        shutdown: async () => {},
        overview: async () => [{ source: id, description: opts.desc ?? "", tools: tools.length }],
        search: async (query) => {
            calls.search++;
            return tools.filter(
                (t) => t.name.toLowerCase().includes(query) || t.description.toLowerCase().includes(query),
            );
        },
        get: async (name) => tools.find((t) => t.name === name) ?? null,
        invoke: async (name) => opts.output ?? `ran ${name}`,
        calls,
    };
}

function card(name, description = "") {
    return { name, source: "x", description, inputSchema: { type: "object" } };
}

test("search：名称命中排在描述命中前", async () => {
    const registry = new ExtensionRegistry();
    registry.register(fakeProvider("a", [
        card("foo_bar", "和关键词完全无关，但描述里提到 bing"),
        card("bing_search", "普通描述"),
    ]));

    const { tools } = await registry.search("bing");
    assert.deepEqual(tools.map((t) => t.name), ["bing_search", "foo_bar"]);
});

test("search：超过上限截断并给出总数", async () => {
    const registry = new ExtensionRegistry();
    registry.register(fakeProvider("a", Array.from({ length: SEARCH_LIMIT + 3 }, (_, i) => card(`tool_${i}`, "公共词"))));

    const { tools, total, truncated } = await registry.search("公共词");
    assert.equal(tools.length, SEARCH_LIMIT, "单次最多返回上限张卡");
    assert.equal(total, SEARCH_LIMIT + 3);
    assert.equal(truncated, true);
});

test("search：空白 query 直接返回空，不进任何来源", async () => {
    const provider = fakeProvider("a", [card("anything")]);
    const registry = new ExtensionRegistry();
    registry.register(provider);

    const { tools, total } = await registry.search("   ");
    assert.deepEqual(tools, []);
    assert.equal(total, 0);
    assert.equal(provider.calls.search, 0, "空白词不应触发来源搜索");
});

test("invoke：超长输出统一截断并标注原长度", async () => {
    const registry = new ExtensionRegistry();
    const size = MAX_OUTPUT_CHARS + 100;
    registry.register(fakeProvider("a", [card("big_tool")], { output: "x".repeat(size) }));

    const output = await registry.invoke("big_tool", {});
    assert.ok(output.length < size, "输出应被截断");
    assert.ok(output.includes(`原长度 ${size}`), "截断标注应包含原长度");
});

test("invoke：未找到时抛错", async () => {
    const registry = new ExtensionRegistry();
    registry.register(fakeProvider("a", [card("exists")]));

    await assert.rejects(() => registry.invoke("not_exists", {}), /未找到/);
});

test("invoke：命中来源的执行结果原样返回", async () => {
    const registry = new ExtensionRegistry();
    registry.register(fakeProvider("a", [card("tool_a")], { output: "ok-a" }));
    registry.register(fakeProvider("b", [card("tool_b")], { output: "ok-b" }));

    assert.equal(await registry.invoke("tool_b", {}), "ok-b");
    assert.equal(await registry.invoke("tool_a", {}), "ok-a");
});

test("init：单来源失败不抛错也不影响其它来源", async () => {
    const registry = new ExtensionRegistry();
    registry.register(fakeProvider("bad", [], { failInit: true }));
    registry.register(fakeProvider("good", [card("tool_g")]));

    await registry.init();
    const found = await registry.get("tool_g");
    assert.ok(found, "另一来源仍可正常查询");
});
