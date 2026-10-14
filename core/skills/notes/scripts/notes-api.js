/**
 * 笔记数据维护封装
 * 以结构化 JSON 列表读写本 skill 的 SKILL.md 中「笔记列表」区块
 *
 * 设计意图：
 * - 作为 notes skill 的内部模块，仅供本 skill 的脚本使用
 * - 笔记数据内嵌于 SKILL.md（force:true 会将其正文固定注入上下文），故直接读写该文件
 * - 通过 <!-- NOTES:START --> / <!-- NOTES:END --> 两个唯一标记定位 JSON 块，
 *   仅替换标记之间的内容，保留 frontmatter 与其余正文不变
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// scripts/ 上一级即 notes/ 技能目录
const SKILL_MD = resolve(__dirname, "..", "SKILL.md");

const BLOCK_RE = /(<!-- NOTES:START -->)([\s\S]*?)(<!-- NOTES:END -->)/;

/** 当天日期 YYYY-MM-DD */
function today() {
    return new Date().toISOString().slice(0, 10);
}

/**
 * 读取并解析笔记数组
 * @returns {Array<{id:number, content:string, tags:string[], createdAt:string, updatedAt:string}>}
 */
export function readNotes() {
    if (!existsSync(SKILL_MD)) {
        throw new Error(`找不到 SKILL.md: ${SKILL_MD}`);
    }
    const content = readFileSync(SKILL_MD, "utf-8");
    const m = content.match(BLOCK_RE);
    if (!m) {
        throw new Error("SKILL.md 缺少 NOTES 标记块，无法读写笔记");
    }
    const jsonMatch = m[2].match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
        throw new Error("NOTES 标记块内缺少 ```json 代码块");
    }
    try {
        const notes = JSON.parse(jsonMatch[1]);
        if (!Array.isArray(notes)) throw new Error("笔记数据不是数组");
        return notes;
    }
    catch (err) {
        throw new Error(`笔记 JSON 解析失败: ${err.message}`);
    }
}

/**
 * 将笔记数组渲染回 SKILL.md 的标记块并写回
 * @param {Array} notes
 */
export function writeNotes(notes) {
    const content = readFileSync(SKILL_MD, "utf-8");
    if (!BLOCK_RE.test(content)) {
        throw new Error("SKILL.md 缺少 NOTES 标记块，无法写回");
    }
    const json = JSON.stringify(notes, null, 2);
    // 用函数返回替换串，避免 json 中的 $ 被当作 replace 的特殊符号
    const updated = content.replace(BLOCK_RE, (_full, start, _mid, end) => {
        return `${start}\n\n\`\`\`json\n${json}\n\`\`\`\n\n${end}`;
    });
    writeFileSync(SKILL_MD, updated, "utf-8");
}

/** 计算下一个自增 id */
function nextId(notes) {
    return notes.reduce((max, n) => Math.max(max, Number(n.id) || 0), 0) + 1;
}

/**
 * 添加笔记
 * @param {{content: string, tags?: string[]}} param
 * @returns {object} 新建的笔记条目
 */
export function addNote({ content, tags }) {
    if (!content || !String(content).trim()) {
        throw new Error("缺少参数: content（笔记内容）");
    }
    const notes = readNotes();
    const now = today();
    const entry = {
        id: nextId(notes),
        content: String(content).trim(),
        tags: Array.isArray(tags) ? tags : [],
        createdAt: now,
        updatedAt: now,
    };
    notes.push(entry);
    writeNotes(notes);
    return entry;
}

/**
 * 更新笔记（按 id，可只改 content 或只改 tags）
 * @param {{id: number, content?: string, tags?: string[]}} param
 * @returns {object} 更新后的笔记条目
 */
export function updateNote({ id, content, tags }) {
    if (id === undefined || id === null) {
        throw new Error("缺少参数: id（要更新的笔记 id）");
    }
    if (content === undefined && tags === undefined) {
        throw new Error("至少要提供 content 或 tags 之一");
    }
    const notes = readNotes();
    const entry = notes.find(n => String(n.id) === String(id));
    if (!entry) {
        throw new Error(`没有找到 id=${id} 的笔记`);
    }
    if (content !== undefined) {
        if (!String(content).trim()) throw new Error("content 不能为空");
        entry.content = String(content).trim();
    }
    if (tags !== undefined) {
        if (!Array.isArray(tags)) throw new Error("tags 必须是数组");
        entry.tags = tags;
    }
    entry.updatedAt = today();
    writeNotes(notes);
    return entry;
}

/**
 * 删除笔记（按 id）
 * @param {{id: number}} param
 * @returns {object} 被删除的笔记条目
 */
export function deleteNote({ id }) {
    if (id === undefined || id === null) {
        throw new Error("缺少参数: id（要删除的笔记 id）");
    }
    const notes = readNotes();
    const idx = notes.findIndex(n => String(n.id) === String(id));
    if (idx === -1) {
        throw new Error(`没有找到 id=${id} 的笔记`);
    }
    const [removed] = notes.splice(idx, 1);
    writeNotes(notes);
    return removed;
}
