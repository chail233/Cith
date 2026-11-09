/**
 * replyParser 解析结果测试
 *
 * Agent 的「格式错误重试一次」完全依赖 ok 标记，因此这里固定住约定的判定口径：
 * - 只有 {action:[...]} 与裸数组算合规
 * - 空 action 数组是合法的「不回复」，不能触发重试
 * - 纯文本 / 无 action 的 JSON / 空内容都算不合规，但降级段必须保留原文，避免二次失败后丢消息
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReplyResult } from "../core/agent/replyParser.ts";

test("标准 {action:[...]} 视为合规并解析出消息段", () => {
    const parsed = parseReplyResult('{"action":[{"type":"text","data":{"text":"你好"}}]}');
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.segments, [{ type: "text", data: { text: "你好" } }]);
});

test("裸数组视为合规（兼容模型直接返回段数组）", () => {
    const parsed = parseReplyResult('[{"type":"text","data":{"text":"在"}}]');
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.segments, [{ type: "text", data: { text: "在" } }]);
});

test("空 action 数组是合法的「不回复」，不得触发重试", () => {
    const parsed = parseReplyResult('{"action":[]}');
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.segments, []);
});

test("纯文本算不合规，且降级段保留原文", () => {
    const parsed = parseReplyResult("稍等，我看一下当前目录的文件");
    assert.equal(parsed.ok, false);
    assert.deepEqual(parsed.segments, [{ type: "text", data: { text: "稍等，我看一下当前目录的文件" } }]);
});

test("JSON 对象但没有 action 字段算不合规", () => {
    const parsed = parseReplyResult('{"city":"北京"}');
    assert.equal(parsed.ok, false);
    assert.equal(parsed.segments.length, 1);
    assert.equal(parsed.segments[0].type, "text");
});

test("空内容算不合规且没有可发送的段", () => {
    for (const empty of ["", "   ", null, undefined]) {
        const parsed = parseReplyResult(empty);
        assert.equal(parsed.ok, false);
        assert.deepEqual(parsed.segments, []);
    }
});
