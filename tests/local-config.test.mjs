/**
 * 本地核心配置管理测试（desktop/src/main/local-config.ts）
 *
 * 全部在临时目录进行：bundle 与数据目录各建一个假环境，不触碰真实 userData。
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
    deepMerge,
    ensureCoreData,
    generateToken,
    readCoreConfig,
    resolveCorePaths,
    saveCoreConfig,
} from "../packages/desktop/src/main/local-config.ts";

/** 本次测试的临时根目录 */
let tempRoot;
let bundleDir;
let coreDataDir;

before(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "cith-local-config-"));
    bundleDir = join(tempRoot, "bundle");
    coreDataDir = join(tempRoot, "core");
    // 假 bundle：prompts / skills / stickers 三处可播种资产
    mkdirSync(join(bundleDir, "prompts"), { recursive: true });
    mkdirSync(join(bundleDir, "skills", "demo", "scripts"), { recursive: true });
    mkdirSync(join(bundleDir, "stickers"), { recursive: true });
    writeFileSync(join(bundleDir, "prompts", "system.md"), "# 默认提示词", "utf8");
    writeFileSync(join(bundleDir, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: 测试技能\n---\n正文", "utf8");
    writeFileSync(join(bundleDir, "skills", "demo", "scripts", "run.js"), "console.log(1)", "utf8");
    writeFileSync(join(bundleDir, "stickers", "manifest.json"), "[]", "utf8");
    // 开发机密钥不应被播种带走的文件
    writeFileSync(join(bundleDir, "config.json"), '{"token":"dev-secret"}', "utf8");
    mkdirSync(join(bundleDir, "data"), { recursive: true });
    writeFileSync(join(bundleDir, "data", "token-usage.json"), "{}", "utf8");
});

after(() => {
    rmSync(tempRoot, { recursive: true, force: true });
});

test("ensureCoreData 首次运行播种完整数据目录", () => {
    const created = ensureCoreData(bundleDir, coreDataDir);
    assert.equal(created, true);

    const cfg = JSON.parse(readFileSync(join(coreDataDir, "config.json"), "utf8"));
    // 生成的 token 不是占位符，桌面 WS 与面板 API 各自独立
    assert.match(cfg.token, /^[0-9a-f]{24}$/);
    assert.match(cfg.web.token, /^[0-9a-f]{24}$/);
    assert.notEqual(cfg.token, cfg.web.token);
    assert.equal(cfg.desktopPort, 2147);
    assert.equal(cfg.enableOnebot, true);
    assert.equal(cfg.enableWechat, true);
    // 微信凭证目录写成绝对路径
    assert.equal(cfg.wechatStorageDir, join(coreDataDir, "wechatbot"));

    // 可播种资产已复制
    assert.equal(readFileSync(join(coreDataDir, "prompts", "system.md"), "utf8"), "# 默认提示词");
    assert.ok(existsSync(join(coreDataDir, "skills", "demo", "SKILL.md")));
    assert.ok(existsSync(join(coreDataDir, "skills", "demo", "scripts", "run.js")));
    assert.equal(readFileSync(join(coreDataDir, "stickers", "manifest.json"), "utf8"), "[]");

    // bundle 里的密钥与运行数据不会被带走
    assert.equal(readCoreConfig(coreDataDir).token, cfg.token);
    assert.ok(!existsSync(join(coreDataDir, "data")));
});

test("ensureCoreData 幂等：已存在的配置与提示词不被覆盖", () => {
    // 用户改过配置与提示词
    const cfgPath = join(coreDataDir, "config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    cfg.chatModel = "user-model";
    writeFileSync(cfgPath, JSON.stringify(cfg), "utf8");
    writeFileSync(join(coreDataDir, "prompts", "system.md"), "# 用户改过的提示词", "utf8");

    const created = ensureCoreData(bundleDir, coreDataDir);
    assert.equal(created, false);
    const after = JSON.parse(readFileSync(cfgPath, "utf8"));
    assert.equal(after.chatModel, "user-model");
    assert.match(after.token, /^[0-9a-f]{24}$/);
    assert.equal(readFileSync(join(coreDataDir, "prompts", "system.md"), "utf8"), "# 用户改过的提示词");
});

test("saveCoreConfig 深合并并原子写回（对象嵌套、无 tmp 残留）", () => {
    const before = readCoreConfig(coreDataDir);
    const merged = saveCoreConfig(coreDataDir, {
        chatModel: "new-model",
        web: { port: 3000 },
        enableWechat: false,
    });

    assert.equal(merged.chatModel, "new-model");
    // 嵌套对象只覆盖写了的字段，token 保留
    assert.equal(merged.web.port, 3000);
    assert.equal(merged.web.token, before.web.token);
    assert.equal(merged.enableWechat, false);
    // 未触碰的键原样保留
    assert.equal(merged.enableOnebot, before.enableOnebot);
    assert.equal(merged.wechatStorageDir, before.wechatStorageDir);

    const onDisk = JSON.parse(readFileSync(join(coreDataDir, "config.json"), "utf8"));
    assert.equal(onDisk.web.port, 3000);
    assert.ok(!existsSync(`${join(coreDataDir, "config.json")}.tmp`));
});

test("deepMerge：普通对象递归合并，数组与标量整体覆盖", () => {
    const merged = deepMerge(
        { a: 1, nested: { x: 1, y: 2 }, list: [1, 2, 3], keep: "old" },
        { nested: { y: 9 }, list: ["all"], other: true },
    );
    assert.deepEqual(merged, { a: 1, nested: { x: 1, y: 9 }, list: ["all"], keep: "old", other: true });
});

test("generateToken 不产生占位符样式的值", () => {
    for (let i = 0; i < 5; i++) {
        assert.doesNotMatch(generateToken(), /^your_/i);
        assert.ok(generateToken().length >= 8);
    }
});

test("resolveCorePaths：打包态在 resources/core，开发态回仓库根", () => {
    const packaged = resolveCorePaths(true, "/app/resources", "/repo/dist");
    assert.equal(packaged.entry, join("/app/resources", "core", "index.js"));
    assert.equal(packaged.cwd, join("/app/resources", "core"));

    const dev = resolveCorePaths(false, "/app/resources", resolve("/repo/dist"));
    assert.equal(dev.entry, resolve("/repo/dist", "index.js"));
    // 开发态工作目录是仓库根（依赖提升后的 node_modules 在那里）
    assert.equal(dev.cwd, resolve("/repo"));
});
