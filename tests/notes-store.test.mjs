/**
 * 全局笔记存储测试
 *
 * 笔记文件运行时懒创建；为不破坏真实运行数据，测试前把现有文件改名备份，结束后还原。
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, renameSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addNote, deleteNote, getNotes, renderNotes, updateNote } from "../core/services/notes-store.ts";

const here = dirname(fileURLToPath(import.meta.url));
const notesFile = resolve(here, "../core/data/notes.json");
const backupFile = `${notesFile}.test-bak`;

before(() => {
    // 备份真实笔记文件（若存在），让存储从空状态开始
    if (existsSync(notesFile)) renameSync(notesFile, backupFile);
});

after(() => {
    rmSync(notesFile, { force: true });
    rmSync(`${notesFile}.tmp`, { force: true });
    // 还原真实笔记文件
    if (existsSync(backupFile)) renameSync(backupFile, notesFile);
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

test("修改与删除，未找到时提示现有编号", async () => {
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
});

test("编号只增不减：删除后不复用", async () => {
    const created = await addNote("编号顺延校验");
    const used = (await getNotes()).map((n) => n.id);
    const maxNum = Math.max(...used.map((id) => Number(id.slice(1))));
    assert.equal(created.match(/\[(n\d+)\]/)[1], `n${maxNum}`);
});

test("修改落盘校验", async () => {
    const id = (await getNotes())[0].id;
    await updateNote(id, "落盘校验内容");
    const expected = (await getNotes()).length;
    await waitPersisted(() => {
        try {
            return JSON.parse(readFileSync(notesFile, "utf-8")).notes.find((n) => n.id === id)?.content === "落盘校验内容";
        }
        catch {
            return false;
        }
    });

    const raw = JSON.parse(readFileSync(notesFile, "utf-8"));
    assert.equal(raw.version, 1);
    assert.equal(raw.notes.length, expected);
    assert.equal(raw.notes.find((n) => n.id === id).content, "落盘校验内容");
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
