/**
 * 全局笔记存储测试
 *
 * 使用临时数据根验证笔记文件的创建与落盘。
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataRoot = mkdtempSync(join(tmpdir(), "cith-notes-test-"));
const dataDir = join(dataRoot, "data");
mkdirSync(dataDir);
const notesFile = join(dataDir, "notes.json");
const previousDataRoot = process.env.CITH_DATA;
process.env.CITH_DATA = dataRoot;
const { addNote, deleteNote, getNotes, renderNotes, updateNote } = await import("../packages/core/services/notes-store.ts");
if (previousDataRoot === undefined) delete process.env.CITH_DATA;
else process.env.CITH_DATA = previousDataRoot;

after(() => {
    rmSync(notesFile, { force: true });
    rmSync(`${notesFile}.tmp`, { force: true });
    rmdirSync(dataDir);
    rmdirSync(dataRoot);
});

/** 等待串行写队列落盘追平：轮询磁盘直到条件满足（写是异步排队的，固定 sleep 会 race） */
async function waitPersisted(check) {
    for (let i = 0; i < 100; i++) {
        if (check()) return;
        await new Promise((r) => setTimeout(r, 50));
    }
    assert.fail("等待落盘超时");
}

test("新增笔记并按编号渲染", async () => {
    const result = await addNote("我喜欢在深夜思考问题");
    assert.match(result, /^已添加 \[n\d+\] 我喜欢在深夜思考问题$/);

    const notes = await getNotes();
    assert.equal(notes.length, 1);
    assert.match(notes[0].id, /^n\d+$/);
    assert.equal(notes[0].content, "我喜欢在深夜思考问题");
    assert.notEqual(notes[0].createdAt, "");
    assert.notEqual(notes[0].updatedAt, "");

    assert.equal(await renderNotes(), `- [${notes[0].id}] 我喜欢在深夜思考问题`);
});

test("空内容与非法内容被拒绝", async () => {
    const before = (await getNotes()).length;
    assert.match(await addNote("   "), /内容为空/);
    assert.match(await addNote(123), /内容为空/);
    assert.equal((await getNotes()).length, before);
});

test("修改和删除笔记后落盘，已删除的编号继续递增", async () => {
    const second = await addNote("第二个笔记");
    const secondId = second.match(/\[(n\d+)\]/)[1];

    const firstId = (await getNotes())[0].id;
    assert.match(await updateNote(firstId, "修改后的内容"), new RegExp(`已更新 \\[${firstId}\\] 修改后的内容`));
    assert.equal((await getNotes()).find((n) => n.id === firstId).content, "修改后的内容");

    assert.match(await deleteNote(secondId), new RegExp(`已删除 \\[${secondId}\\]`));
    assert.equal((await getNotes()).some((n) => n.id === secondId), false);

    const ids = (await getNotes()).map((n) => n.id).join("、");
    assert.match(await updateNote("n9999", "x"), new RegExp(`未找到笔记 n9999，当前有：${ids}`));
    assert.match(await deleteNote(secondId), /未找到笔记/);

    const nextId = `n${Number(secondId.slice(1)) + 1}`;
    assert.match(await addNote("编号顺延校验"), new RegExp(`\\[${nextId}\\]`));
    const expected = await getNotes();
    await waitPersisted(() => {
        try {
            return JSON.parse(readFileSync(notesFile, "utf-8")).notes.some((n) => n.id === nextId);
        }
        catch {
            return false;
        }
    });

    const raw = JSON.parse(readFileSync(notesFile, "utf-8"));
    assert.equal(raw.version, 1);
    assert.deepEqual(raw.notes, expected);
});

test("条数上限：超出后拒绝新增并引导删减", async () => {
    // 补到上限（前序测试已占用若干条）
    const fill = 100 - (await getNotes()).length;
    for (let i = 0; i < fill; i++) {
        const r = await addNote(`填充笔记 ${i}`);
        assert.match(r, /^已添加/);
    }
    assert.equal((await getNotes()).length, 100);
    // 排干写队列再结束，避免 after() 删文件后残余队列又把文件重建出来
    await waitPersisted(() => JSON.parse(readFileSync(notesFile, "utf-8")).notes.length === 100);

    assert.match(await addNote("超额笔记"), /已达上限（100 条）/);
    assert.equal((await getNotes()).length, 100);
});
