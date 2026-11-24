/**
 * 长期记忆容量淘汰策略测试
 *
 * 只测纯函数 selectEvictions，不触碰 rememori / config，
 * 运行：npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVICT_GRACE_MS, selectEvictions } from "../packages/core/services/memory-eviction.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_760_000_000_000;

/** 构造一条记录：daysAgo 为创建时间距 now 的天数 */
function rec(id, daysAgo, importance = 0.8) {
    return { id, importance, createdAt: NOW - daysAgo * DAY };
}

test("容量未超限或上限为 0 时不淘汰", () => {
    const records = [rec("a", 3), rec("b", 2)];
    assert.deepEqual(selectEvictions(records, 5, NOW), [], "未超限不应淘汰");
    assert.deepEqual(selectEvictions(records, 2, NOW), [], "刚好等于上限不应淘汰");
    assert.deepEqual(selectEvictions(records, 0, NOW), [], "0 表示不限");
    assert.deepEqual(selectEvictions(records, -1, NOW), [], "负值等同不限");
});

test("超出部分按 importance 升序、创建时间升序淘汰", () => {
    const records = [
        rec("important-old", 30, 0.9),
        rec("weak-new", 5, 0.3),
        rec("mid", 10, 0.5),
        rec("weak-old", 20, 0.3),
        rec("mid2", 2, 0.5),
    ];
    const originalOrder = records.map((r) => r.id);
    // 上限 3 → 删 2 条：importance 最低的两条里先删更旧的；importance 高的不参与
    assert.deepEqual(selectEvictions(records, 3, NOW), ["weak-old", "weak-new"]);
    assert.deepEqual(records.map((r) => r.id), originalOrder);
});

test("容量仍超限时也只淘汰已超过保护期的记录", () => {
    const records = [
        { id: "edge-old", importance: 0.8, createdAt: NOW - EVICT_GRACE_MS - 1 },
        { id: "edge-new", importance: 0.8, createdAt: NOW - EVICT_GRACE_MS + 1 },
        rec("fresh", 0),
    ];
    assert.deepEqual(selectEvictions(records, 1, NOW), ["edge-old"]);
});
