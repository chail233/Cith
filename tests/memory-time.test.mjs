/**
 * 长期记忆时间格式化测试
 *
 * 只测纯函数 formatMemoryTime，不触碰 rememori / config，
 * 运行：npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMemoryTime } from "../packages/core/utils/time.js";

const DAY = 24 * 60 * 60 * 1000;

/** 基准时间用本地时区构造，与被测函数的本地格式化保持一致 */
const BASE = new Date(2026, 8, 12, 10, 0, 0).getTime();

test("当天显示为今天", () => {
    assert.equal(formatMemoryTime(BASE, BASE + 3 * 60 * 60 * 1000), "2026-09-12，今天");
});

test("差一天显示为昨天", () => {
    assert.equal(formatMemoryTime(BASE, BASE + DAY), "2026-09-12，昨天");
});

test("一个月内显示具体天数", () => {
    assert.equal(formatMemoryTime(BASE, BASE + 52 * DAY), "2026-09-12，52天前");
    assert.equal(formatMemoryTime(BASE, BASE + 2 * DAY), "2026-09-12，2天前");
});

test("超过一年改用年", () => {
    assert.equal(formatMemoryTime(BASE, BASE + 364 * DAY), "2026-09-12，364天前");
    assert.equal(formatMemoryTime(BASE, BASE + 365 * DAY), "2026-09-12，1年前");
    assert.equal(formatMemoryTime(BASE, BASE + 800 * DAY), "2026-09-12，2年前");
});

test("时钟回拨不显示负数天", () => {
    assert.equal(formatMemoryTime(BASE, BASE - DAY), "2026-09-12，今天");
});

test("日期补零", () => {
    const early = new Date(2026, 0, 5, 8, 0, 0).getTime();
    assert.equal(formatMemoryTime(early, early + DAY), "2026-01-05，昨天");
});

test("时间非法时返回空串", () => {
    assert.equal(formatMemoryTime(NaN), "");
    assert.equal(formatMemoryTime(undefined), "");
    assert.equal(formatMemoryTime(null), "");
    assert.equal(formatMemoryTime(0), "");
    assert.equal(formatMemoryTime(-1), "");
    assert.equal(formatMemoryTime("abc"), "");
});
