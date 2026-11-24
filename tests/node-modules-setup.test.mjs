/**
 * 首启解压模块测试（desktop/src/main/node-modules-setup.ts）
 * 全部在临时目录进行：tar 用 tar 包现场造，损坏 tar 用乱字节模拟
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create as tarCreate } from "tar";
import { ensureNodeModules } from "../packages/desktop/src/main/node-modules-setup.ts";

let tempRoot;

before(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "cith-node-modules-setup-"));
});

after(() => {
    rmSync(tempRoot, { recursive: true, force: true });
});

/** 造一个 3 个文件的 node_modules.tar + manifest（路径口径与 stage 脚本一致） */
async function seedTar(coreDir, { files = 3 } = {}) {
    // 造树放独立目录，不碰 coreDir 里可能已存在的 node_modules
    const work = join(coreDir, ".tarwork");
    const src = join(work, "node_modules");
    mkdirSync(join(src, "sub"), { recursive: true });
    mkdirSync(join(src, "deep/sub"), { recursive: true });
    writeFileSync(join(src, "a.txt"), "a");
    writeFileSync(join(src, "sub/b.txt"), "b");
    writeFileSync(join(src, "deep/sub/c.txt"), "c");
    await tarCreate({ file: join(coreDir, "node_modules.tar"), cwd: work, portable: true }, ["node_modules"]);
    writeFileSync(join(coreDir, "node_modules.tar.json"), `${JSON.stringify({ files, bytes: 123 })}\n`);
    rmSync(work, { recursive: true, force: true });
}

function newCoreDir(name) {
    const dir = join(tempRoot, name);
    mkdirSync(dir, { recursive: true });
    return dir;
}

function collectProgress(progressLog) {
    return (filesDone, filesTotal) => progressLog.push([filesDone, filesTotal]);
}

test("无 tar 且无 node_modules：报打包产物不完整", async () => {
    const coreDir = newCoreDir("missing-both");
    const outcome = await ensureNodeModules({ coreDir, appVersion: "0.2.1" });
    assert.equal(outcome.ok, false);
    assert.match(outcome.message, /node_modules\.tar/);
    assert.match(outcome.message, /重新安装/);
});

test("无 tar 但有散装 node_modules：跳过（dev / 旧安装路径）", async () => {
    const coreDir = newCoreDir("loose-only");
    mkdirSync(join(coreDir, "node_modules"));
    writeFileSync(join(coreDir, "node_modules/x.txt"), "x");
    const outcome = await ensureNodeModules({ coreDir, appVersion: "0.2.1" });
    assert.deepEqual(outcome, { ok: true, skipped: true });
    assert.equal(readFileSync(join(coreDir, "node_modules/x.txt"), "utf8"), "x");
});

test("happy path：解压就位、marker 写入、文件数与 manifest 一致、进度收口", async () => {
    const coreDir = newCoreDir("happy");
    await seedTar(coreDir);
    const progressLog = [];
    const outcome = await ensureNodeModules({ coreDir, appVersion: "0.2.1", onProgress: collectProgress(progressLog) });
    assert.deepEqual(outcome, { ok: true, skipped: false });

    assert.equal(existsSync(join(coreDir, "node_modules/a.txt")), true);
    assert.equal(existsSync(join(coreDir, "node_modules/deep/sub/c.txt")), true);
    assert.equal(existsSync(join(coreDir, "node_modules/node_modules")), false);

    const marker = JSON.parse(readFileSync(join(coreDir, "node_modules/.cith-setup.json"), "utf8"));
    assert.equal(marker.version, "0.2.1");
    assert.equal(marker.files, 3);

    const last = progressLog.at(-1);
    assert.deepEqual(last, [3, 3]);

    const leftovers = readdirSync(coreDir).filter((n) => n.startsWith("node_modules."));
    assert.deepEqual(leftovers, ["node_modules.tar", "node_modules.tar.json"]);
});

test("版本一致跳过解压，升级时整体替换旧依赖", async () => {
    const coreDir = newCoreDir("marker");
    await seedTar(coreDir);
    await ensureNodeModules({ coreDir, appVersion: "0.2.1" });
    const stale = join(coreDir, "node_modules/stale.txt");
    writeFileSync(stale, "旧文件");

    const again = await ensureNodeModules({ coreDir, appVersion: "0.2.1" });
    assert.deepEqual(again, { ok: true, skipped: true });
    assert.ok(existsSync(stale));

    const upgraded = await ensureNodeModules({ coreDir, appVersion: "0.3.0" });
    assert.deepEqual(upgraded, { ok: true, skipped: false });
    const marker = JSON.parse(readFileSync(join(coreDir, "node_modules/.cith-setup.json"), "utf8"));
    assert.equal(marker.version, "0.3.0");
    assert.ok(!existsSync(stale));
    assert.ok(existsSync(join(coreDir, "node_modules/a.txt")));
});

test("manifest 计数不符：报错且不动已存在的 node_modules", async () => {
    const coreDir = newCoreDir("count-mismatch");
    mkdirSync(join(coreDir, "node_modules"));
    writeFileSync(join(coreDir, "node_modules/keep.txt"), "保留");
    await seedTar(coreDir, { files: 999 });

    const outcome = await ensureNodeModules({ coreDir, appVersion: "0.2.1" });
    assert.equal(outcome.ok, false);
    assert.match(outcome.message, /校验不符/);
    assert.equal(existsSync(join(coreDir, "node_modules/keep.txt")), true);
    assert.equal(readdirSync(coreDir).some((n) => n.startsWith("node_modules.extracting")), false);
    assert.equal(readdirSync(coreDir).some((n) => n.startsWith("node_modules.replacing")), false);
});

test("损坏 tar：报错且清理临时目录", async () => {
    const coreDir = newCoreDir("corrupt");
    writeFileSync(join(coreDir, "node_modules.tar"), "这不是一个 tar 文件");
    writeFileSync(join(coreDir, "node_modules.tar.json"), `${JSON.stringify({ files: 3, bytes: 123 })}\n`);

    const outcome = await ensureNodeModules({ coreDir, appVersion: "0.2.1" });
    assert.equal(outcome.ok, false);
    assert.match(outcome.message, /解压核心依赖失败/);
    assert.equal(existsSync(join(coreDir, "node_modules")), false);
    assert.equal(existsSync(join(coreDir, "node_modules.extracting")), false);
});

test("中断残留（staging / 换出目录）会在下次启动时清掉", async () => {
    const coreDir = newCoreDir("stale");
    mkdirSync(join(coreDir, "node_modules.extracting"));
    writeFileSync(join(coreDir, "node_modules.extracting/junk.txt"), "半成品");
    mkdirSync(join(coreDir, "node_modules.replacing-123"));
    writeFileSync(join(coreDir, "node_modules.replacing-123/junk.txt"), "旧目录");
    await seedTar(coreDir);

    const outcome = await ensureNodeModules({ coreDir, appVersion: "0.2.1" });
    assert.equal(outcome.ok, true);
    assert.equal(existsSync(join(coreDir, "node_modules.extracting")), false);
    assert.equal(existsSync(join(coreDir, "node_modules.replacing-123")), false);
    assert.equal(existsSync(join(coreDir, "node_modules/a.txt")), true);
});
