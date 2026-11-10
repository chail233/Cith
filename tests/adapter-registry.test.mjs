/**
 * 通道适配器注册表测试
 *
 * 路由不再认识任何具体平台名，靠适配器自报的 channel 与 accepts 决定：
 * - Space.channel 精确匹配优先
 * - 没人能服务时返回 null（旧实现会硬回落到 onebot，把微信会话发给 QQ）
 * - 注销只对登记的那个实例生效，旧实例的关闭事件不会顶掉新实例
 * - 愿意跨通道兜底的适配器在精确匹配失败后接手
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import BaseAdapter from "../core/bot/adapters/BaseAdapter.ts";
import { registerAdapter, unregisterAdapter, resolveAdapter } from "../core/services/adapter-registry.js";

/** 最小适配器替身：只关心通道与 accepts */
class FakeAdapter extends BaseAdapter {
    constructor(channel) {
        super(async () => {});
        this.channel = channel;
    }

    async sendMsg() {}

    replyCapabilities() {
        return [];
    }
}

/** 什么会话都愿意发的替身 */
class AnywhereAdapter extends FakeAdapter {
    accepts() {
        return true;
    }
}

const GROUP = { from: "group", id: "10001", channel: "onebot" };
const WECHAT_USER = { from: "user", id: "wx_abc", channel: "wechat" };
const UNKNOWN = { from: "user", id: "u1", channel: "telegram" };

let onebot;
let wechat;
let bridge;

beforeEach(() => {
    onebot = new FakeAdapter("onebot");
    wechat = new FakeAdapter("wechat");
    bridge = null;
    registerAdapter("onebot", onebot);
    registerAdapter("wechat", wechat);
});

afterEach(() => {
    if (bridge) unregisterAdapter("bridge", bridge);
});

test("按 Space.channel 精确路由到对应适配器", () => {
    assert.equal(resolveAdapter(GROUP), onebot);
    assert.equal(resolveAdapter(WECHAT_USER), wechat);
});

test("没有通道能服务时返回 null，不再硬回落到别的平台", () => {
    assert.equal(resolveAdapter(UNKNOWN), null);

    unregisterAdapter("onebot", onebot);
    assert.equal(resolveAdapter(GROUP), null, "群聊不该退给微信适配器");
});

test("注销只对登记的那个实例生效", () => {
    const stale = new FakeAdapter("onebot");
    unregisterAdapter("onebot", stale);
    assert.equal(resolveAdapter(GROUP), onebot, "旧实例的关闭事件不该顶掉新实例");

    unregisterAdapter("onebot", onebot);
    assert.equal(resolveAdapter(GROUP), null);
});

test("愿意跨通道兜底的适配器在精确匹配失败后接手", () => {
    bridge = new AnywhereAdapter("bridge");
    registerAdapter("bridge", bridge);
    // 精确匹配优先，与注册顺序无关
    assert.equal(resolveAdapter(WECHAT_USER), wechat);

    unregisterAdapter("onebot", onebot);
    unregisterAdapter("wechat", wechat);
    assert.equal(resolveAdapter(WECHAT_USER), bridge);
    assert.equal(resolveAdapter(UNKNOWN), bridge);
});
