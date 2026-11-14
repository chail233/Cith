import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import logger from "../utils/logger.js";
import { resolveSrcPath } from "../utils/file-security.js";

const STORE_PATH = "data/notes.json";

/** 笔记条数上限：超出后拒绝新增，由模型自行删减 */
const MAX_NOTES = 100;
/** 单条笔记内容上限（字符），超出部分截断 */
const MAX_NOTE_CHARS = 300;

/** 一条全局笔记 */
export interface Note {
    id: string;
    content: string;
    createdAt: string;
    updatedAt: string;
}

interface NotesState {
    version: number;
    notes: Note[];
}

let state: NotesState = { version: 1, notes: [] };
/** 下一个笔记编号（n1 起，只增不减；从文件里已有编号推算） */
let nextId = 1;
/** 首次加载的去重 Promise：并发调用必须等同一个加载完成，否则后到更新会被加载结果覆盖 */
let loadPromise: Promise<void> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function storeFile(): string {
    const r = resolveSrcPath(STORE_PATH);
    if (r.error) throw new Error(r.error);
    return r.fullPath ?? "";
}

/** 内容归一化：trim + 截断；空内容返回 null 表示无效 */
function normalizeContent(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const text = raw.trim().slice(0, MAX_NOTE_CHARS);
    return text === "" ? null : text;
}

function doLoad(): Promise<void> {
    return (async () => {
        try {
            const raw = JSON.parse(await readFile(storeFile(), "utf-8")) as Partial<NotesState>;
            if (Array.isArray(raw.notes)) {
                let maxNum = 0;
                const notes: Note[] = [];
                for (const n of raw.notes) {
                    const content = normalizeContent(n?.content);
                    if (!content || typeof n.id !== "string") continue;
                    const m = /^n(\d+)$/.exec(n.id);
                    if (m) maxNum = Math.max(maxNum, Number(m[1]));
                    notes.push({
                        id: n.id,
                        content,
                        createdAt: typeof n.createdAt === "string" ? n.createdAt : "",
                        updatedAt: typeof n.updatedAt === "string" ? n.updatedAt : "",
                    });
                }
                state = { version: 1, notes };
                nextId = maxNum + 1;
            }
        }
        catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code !== "ENOENT") logger.error("笔记读取失败:", err);
        }
    })();
}

/** 加载持久化数据 */
function load(): Promise<void> {
    loadPromise ??= doLoad();
    return loadPromise;
}

/** 是否已有待执行的写任务：有的话不再重复排队，它落盘时自然会带上最新状态 */
let writePending = false;

/**
 * 串行队列 + tmp/rename 原子落盘，避免并发写坏文件
 * 突发的连续变更合并为一次写：payload 在落盘时才取最新状态
 */
function persist(): void {
    if (writePending) return;
    writePending = true;
    writeQueue = writeQueue
        .then(async () => {
            writePending = false;
            const path = storeFile();
            await mkdir(dirname(path), { recursive: true });
            const tmp = `${path}.tmp`;
            await writeFile(tmp, JSON.stringify({ version: 1, notes: state.notes }, null, 2), "utf-8");
            await rename(tmp, path);
        })
        .catch((err) => {
            writePending = false;
            logger.error("笔记保存失败:", err);
        });
}

/** 按 id 找笔记；id 非法或不存在返回 null */
function findNote(rawId: unknown): Note | null {
    if (typeof rawId !== "string") return null;
    return state.notes.find((n) => n.id === rawId.trim()) ?? null;
}

/** 未找到时的提示：附上现有编号，便于模型自我纠正 */
function notFoundMsg(rawId: unknown): string {
    const ids = state.notes.map((n) => n.id).join("、");
    return ids ? `未找到笔记 ${String(rawId)}，当前有：${ids}` : `未找到笔记 ${String(rawId)}，笔记当前为空`;
}

/** 获取全部笔记（副本） */
export async function getNotes(): Promise<Note[]> {
    await load();
    return state.notes.map((n) => ({ ...n }));
}

/** 渲染注入文本（与工具引用的编号一致）；空笔记返回空串 */
export async function renderNotes(): Promise<string> {
    await load();
    return state.notes.map((n) => `- [${n.id}] ${n.content}`).join("\n");
}

/** 渲染进上下文的笔记 system 消息全文（Agent.buildMessages 与笔记维护 pass 共用）；空笔记返回 null */
export async function renderNotesBlock(): Promise<string | null> {
    const text = await renderNotes();
    return text ? `你的笔记（全局，由你自己维护）：\n${text}` : null;
}

/** 新增一条笔记，返回给模型的执行结果文本 */
export async function addNote(rawContent: unknown): Promise<string> {
    await load();
    const content = normalizeContent(rawContent);
    if (!content) return "内容为空，笔记未保存";
    if (state.notes.length >= MAX_NOTES) return `笔记已达上限（${MAX_NOTES} 条），请先用 delete_note 删除不再重要的笔记`;
    const now = new Date().toISOString();
    const note: Note = { id: `n${nextId}`, content, createdAt: now, updatedAt: now };
    nextId++;
    state.notes.push(note);
    void persist();
    return `已添加 [${note.id}] ${note.content}`;
}

/** 修改一条笔记的内容 */
export async function updateNote(rawId: unknown, rawContent: unknown): Promise<string> {
    await load();
    const note = findNote(rawId);
    if (!note) return notFoundMsg(rawId);
    const content = normalizeContent(rawContent);
    if (!content) return "内容为空，笔记未更新";
    note.content = content;
    note.updatedAt = new Date().toISOString();
    void persist();
    return `已更新 [${note.id}] ${note.content}`;
}

/** 删除一条笔记 */
export async function deleteNote(rawId: unknown): Promise<string> {
    await load();
    const note = findNote(rawId);
    if (!note) return notFoundMsg(rawId);
    state.notes = state.notes.filter((n) => n.id !== note.id);
    void persist();
    return `已删除 [${note.id}] ${note.content}`;
}
