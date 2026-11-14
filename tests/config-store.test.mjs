/**
 * 配置 schema / store 行为测试
 *
 * 全部跑在临时目录，不读写真实的 core/config.json：
 * - schema 自洽：默认值能通过自己的校验、分组声明齐全、旧键映射无重复
 * - 加载：覆盖默认值、旧键名迁移、类型不符退回默认值、未知键忽略
 * - 写入：类型 / 范围 / enum / nullable 校验，赋即热改，只写改动键
 * - 快照：敏感字段脱敏，隐藏字段不出现，密钥泄漏到别的字段也会被遮蔽
 *
 * 运行：npm test
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigStore } from "../packages/core/config/store.ts";
import { CONFIG_GROUPS, CONFIG_KEYS, CONFIG_SCHEMA, LEGACY_KEYS, validateFieldValue } from "../packages/core/config/schema.ts";

/** 这几类结构复杂，只走各自的专用分支，不参与通用校验 */
const SPECIAL_TYPES = new Set(["object", "objectArray", "map"]);

let dir;
let originalWarn;

before(() => {
    dir = mkdtempSync(join(tmpdir(), "cith-config-"));
    // store 的加载期告警是预期行为，别把测试输出刷满
    originalWarn = console.warn;
    console.warn = () => {};
});

after(() => {
    console.warn = originalWarn;
    rmSync(dir, { recursive: true, force: true });
});

/** 在临时目录里造一个 config.json 并返回路径 */
function configFile(name, data) {
    const path = join(dir, name);
    writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data), "utf8");
    return path;
}

test("schema: 每个默认值都能通过自己的校验", () => {
    for (const key of CONFIG_KEYS) {
        const meta = CONFIG_SCHEMA[key];
        if (SPECIAL_TYPES.has(meta.type)) continue;
        const check = validateFieldValue(meta, meta.default);
        assert.ok(check.ok, `${key} 的默认值不合法：${check.reason}`);
    }
});

test("schema: 分组与旧键映射自洽", () => {
    const groups = new Set(CONFIG_GROUPS);
    const legacyTargets = new Set();
    for (const key of CONFIG_KEYS) {
        const meta = CONFIG_SCHEMA[key];
        assert.ok(groups.has(meta.group), `${key} 的分组 ${meta.group} 不在 CONFIG_GROUPS 里`);
        assert.ok(meta.label.length > 0, `${key} 缺少 panel 标签`);
        if (meta.type === "enum") assert.ok((meta.options ?? []).includes(meta.default), `${key} 的默认值不在 enum 候选里`);
        if (meta.legacyKey !== undefined) {
            assert.ok(!legacyTargets.has(key), `${key} 被多个旧键指向`);
            legacyTargets.add(key);
            assert.equal(LEGACY_KEYS.get(meta.legacyKey), key);
        }
    }
});

test("store: 没有配置文件时全部使用默认值", () => {
    const store = new ConfigStore({ configPath: join(dir, "absent.json"), persist: false });
    assert.equal(store.wsPort, CONFIG_SCHEMA.wsPort.default);
    assert.equal(store.enableProactiveChat, true);
    assert.deepEqual(store.targetGroupId, CONFIG_SCHEMA.targetGroupId.default);
    // 对象类默认值必须逐实例深拷贝，避免两个 store 共享同一个 Map
    assert.ok(store.members instanceof Map);
    assert.notEqual(store.members, new ConfigStore({ configPath: join(dir, "absent2.json"), persist: false }).members);
});

test("store: 覆盖默认值、旧键迁移、类型不符退回默认值", () => {
    const path = configFile("merge.json", {
        _comment: "说明文字不参与配置",
        wsPort: 9000,
        CHAT_MODEL: "旧键模型",
        chatModel: "新键模型",
        proactiveChatLimit: "15",
        members: { 205377062: "刘宗伟" },
        web: { port: "2145", token: "面板token", unknownChild: 1 },
        memoryEmbedApiKey: null,
    });
    const store = new ConfigStore({ configPath: path });

    assert.equal(store.wsPort, 9000);
    assert.equal(store.chatModel, "新键模型", "新旧键同时存在时以新键为准");
    assert.equal(store.proactiveChatLimit, CONFIG_SCHEMA.proactiveChatLimit.default, "字符串数字应退回默认值");
    assert.equal(store.members.get("205377062"), "刘宗伟");
    assert.equal(store.web.token, "面板token");
    assert.equal(store.web.port, 2145, "web.port 类型不符应退回默认值");
    assert.equal(store.memoryEmbedApiKey, null, "nullable 字段允许 null");

    const saved = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(saved.CHAT_MODEL, undefined, "旧键应在加载期迁移掉");
    assert.equal(saved.chatModel, "新键模型");
});

test("store: 写入按 schema 校验类型、范围与枚举", () => {
    const store = new ConfigStore({ configPath: join(dir, "write.json"), persist: false });

    assert.throws(() => store.update("selfId", 123), /需要字符串/, "数字不能写进字符串字段");
    assert.throws(() => store.update("proactiveChatLimit", "15"), /需要整数/, "字符串数字不应被隐式转换");
    assert.throws(() => store.update("wsPort", 1.5), /需要整数/);
    assert.throws(() => store.update("memoryMinSimilarity", 2), /不能大于 1/);
    assert.throws(() => store.update("memoryEmbedProvider", "azure"), /只能是 ollama \/ openai/);
    assert.throws(() => store.update("targetUserId", [123]), /必须都是字符串/);
    assert.throws(() => store.update("aiApiKey", null), /不能为 null/, "非 nullable 字段拒绝 null");
    assert.throws(() => store.update("mcpServers", []), /只能通过 config.json 修改/);

    store.update("wsPort", 8081);
    assert.equal(store.wsPort, 8081, "校验通过后内存立即生效");
});

test("store: 顶层赋值即热改，落盘只覆盖改动键", () => {
    const path = configFile("hot.json", { _comment: "保留我", chatModel: "旧模型" });
    const store = new ConfigStore({ configPath: path });

    store.chatModel = "新模型";
    assert.equal(store.chatModel, "新模型");

    const saved = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(saved.chatModel, "新模型");
    assert.equal(saved._comment, "保留我", "手写的说明键必须保留");
    assert.equal(saved.wsPort, undefined, "未改动的键不应写进 config.json");
    assert.throws(() => { store.wsPort = "not-a-number"; }, /需要整数/, "赋值同样走校验");
    assert.equal(store.wsPort, CONFIG_SCHEMA.wsPort.default);

    // 不落盘的字段（members / mcpServers）只改内存
    store.members.set("1", "甲");
    assert.equal(JSON.parse(readFileSync(path, "utf8")).members, undefined);
});

test("store: 快照脱敏、隐藏字段不出现、密钥不会经其他字段泄漏", () => {
    const store = new ConfigStore({ configPath: join(dir, "snapshot.json"), persist: false });
    store.update("aiApiKey", "sk-very-secret-123456");
    store.update("targetUserId", ["sk-very-secret-123456", "702788595"]);

    const snapshot = store.snapshot();
    assert.equal(snapshot.values.aiApiKey, "***");
    assert.equal(snapshot.values.token, "***");
    assert.deepEqual(snapshot.values.targetUserId, ["***", "702788595"], "敏感值出现在别的字段也要遮蔽");
    assert.equal(snapshot.values.systemPrompt, undefined, "隐藏字段不进入快照");
    assert.equal(snapshot.values.members, undefined);
    assert.equal(snapshot.values.mcpServers, undefined);

    const aiApiKey = snapshot.fields.find((field) => field.key === "aiApiKey");
    assert.equal(aiApiKey.secret, true);
    assert.equal(aiApiKey.writable, true);
    assert.equal(snapshot.fields.every((field) => field.group.length > 0), true);
});
