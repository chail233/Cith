import { readFile, writeFile, mkdir, rename, readdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import config from "../config.js";
import logger from "../utils/logger.js";
import { resolveSrcPath } from "../utils/file-security.js";
import type { Plan } from "./plan.ts";

const SNAPSHOT_DIR = "data/sessions";
const VERSION = 1;


export interface SessionSnapshotData {
    savedAt: string;
    recorder: { messages: unknown[]; midSummary: string; msgWithoutChat: number };
    plan: Plan | null;
    pendingTrigger: unknown | null;
    usage: { requests: number; inputTokens: number; cachedTokens: number };
}


const pending = new Map<string, SessionSnapshotData>();
const dirty = new Map<string, SessionSnapshotData | null>();
let writeQueue: Promise<void> = Promise.resolve();
let flushPending = false;

function storeDir(): string {
    const r = resolveSrcPath(SNAPSHOT_DIR);
    if (r.error) throw new Error(r.error);
    return r.fullPath ?? "";
}

function sessionFile(id: string): string {
    const r = resolveSrcPath(join(SNAPSHOT_DIR, `${encodeURIComponent(id)}.json`));
    if (r.error) throw new Error(r.error);
    return r.fullPath ?? "";
}

function countOf(raw: unknown): number {
    return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : 0;
}


function normalizeSnapshot(raw: unknown): SessionSnapshotData | null {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (r.version !== VERSION) return null;
    const rec = (typeof r.recorder === "object" && r.recorder !== null ? r.recorder : {}) as Record<string, unknown>;
    const usage = (typeof r.usage === "object" && r.usage !== null ? r.usage : {}) as Record<string, unknown>;
    const messages = Array.isArray(rec.messages)
        ? rec.messages.filter((m): m is Record<string, unknown> =>
            typeof m === "object" && m !== null && typeof (m as { role?: unknown }).role === "string")
        : [];
    return {
        savedAt: typeof r.savedAt === "string" ? r.savedAt : "",
        recorder: {
            messages,
            midSummary: typeof rec.midSummary === "string" ? rec.midSummary : "",
            msgWithoutChat: countOf(rec.msgWithoutChat),
        },
        plan: typeof r.plan === "object" && r.plan !== null ? r.plan as Plan : null,
        pendingTrigger: typeof r.pendingTrigger === "object" && r.pendingTrigger !== null ? r.pendingTrigger : null,
        usage: {
            requests: countOf(usage.requests),
            inputTokens: countOf(usage.inputTokens),
            cachedTokens: countOf(usage.cachedTokens),
        },
    };
}

/** 是否有值得恢复的内容：没有的快照落盘时改为删除文件（#clear 清空后即此情形） */
function hasContent(data: SessionSnapshotData): boolean {
    return data.recorder.messages.length > 0
        || data.recorder.midSummary !== ""
        || data.plan !== null
        || data.pendingTrigger !== null;
}

/**
 * 启动时从磁盘加载全部快照进待恢复区
 */
export async function initSessionStore(): Promise<void> {
    if (!config.enableSessionSnapshot) return;
    pending.clear();
    let names: string[];
    try {
        names = (await readdir(storeDir())).filter((n) => n.endsWith(".json"));
    }
    catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") logger.error("会话快照目录读取失败:", err);
        return;
    }
    for (const name of names) {
        try {
            const id = decodeURIComponent(name.slice(0, -".json".length));
            const snapshot = normalizeSnapshot(JSON.parse(await readFile(join(storeDir(), name), "utf-8")));
            if (!snapshot) {
                logger.warn(`跳过无效会话快照: ${name}`);
                continue;
            }
            pending.set(id, snapshot);
        }
        catch (err) {
            logger.warn(`跳过无法解析的会话快照: ${name}`, err);
        }
    }
    if (pending.size > 0) logger.info(`已加载 ${pending.size} 份会话快照`);
}

/**
 * 取出会话的待恢复快照
 * @returns 不存在时返回 null
 */
export function takeSessionSnapshot(id: string): SessionSnapshotData | null {
    const data = pending.get(id) ?? null;
    pending.delete(id);
    return data;
}


export function scheduleSessionSave(id: string, data: SessionSnapshotData): void {
    if (!config.enableSessionSnapshot) return;
    const meaningful = hasContent(data);
    dirty.set(id, meaningful ? data : null);
    if (meaningful) pending.set(id, data);
    else pending.delete(id);
    if (!flushPending) {
        flushPending = true;
        writeQueue = writeQueue
            .then(flushDirty)
            .catch((err) => logger.error("会话快照落盘失败:", err));
    }
}


async function flushDirty(): Promise<void> {
    flushPending = false;
    const batch = [...dirty.entries()];
    dirty.clear();
    for (const [id, data] of batch) {
        try {
            const path = sessionFile(id);
            if (data && hasContent(data)) {
                await mkdir(dirname(path), { recursive: true });
                const tmp = `${path}.tmp`;
                await writeFile(tmp, JSON.stringify({ version: VERSION, ...data }, null, 2), "utf-8");
                await rename(tmp, path);
            }
            else {
                await unlink(path).catch((err) => {
                    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
                });
            }
        }
        catch (err) {
            logger.error(`会话快照写入失败: ${id}`, err);
        }
    }
}

export function flushSessionSaves(): Promise<void> {
    return writeQueue;
}
