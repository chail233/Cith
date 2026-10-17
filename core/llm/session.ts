

import { ChatRecorder } from "./recorder.js";
import logger from "../utils/logger.js";
import { deletePlan } from "./plan.ts";
import type { Space } from "../types/index.ts";

// tsconfig 未配置 @types/node（历史遗留），此处按 Node 签名做最小声明
declare const setInterval: (handler: () => void, timeout: number) => { unref(): void };

/** 空闲超过该时长的会话会被回收（先压缩记忆） */
const IDLE_TTL_MS = 30 * 60 * 1000;
/** 回收扫描间隔 */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
/** 会话数量上限，超出时按最久未活跃回收（防止内存无限增长） */
const MAX_SESSIONS = 50;

interface SessionEntry {
    recorder: ChatRecorder;
    lastActive: number;
}

export interface SessionInfo {
    id: string;
    short: number;
    cache: number;
    hasSummary: boolean;
    idleMin: number;
}

const sessions = new Map<string, SessionEntry>();

/**
 * 由消息空间生成会话 ID
 */
export function sessionIdOf(space: Space): string {
    return `${space.from}:${space.id}`;
}

/**
 * 获取（必要时创建）某空间对应的记录器，并刷新活跃时间
 */
export function getRecorder(space: Space): ChatRecorder {
    const id = sessionIdOf(space);
    let entry = sessions.get(id);
    if (!entry) {
        if (sessions.size >= MAX_SESSIONS) {
            retireLeastRecent();
        }
        entry = { recorder: new ChatRecorder(undefined, id), lastActive: Date.now() };
        sessions.set(id, entry);
        logger.debug(`新建会话: ${id}`);
    }
    entry.lastActive = Date.now();
    return entry.recorder;
}

/**
 * 会话概览列表（供 #sessions 命令使用）
 */
export function listSessions(): SessionInfo[] {
    const now = Date.now();
    return [...sessions.entries()].map(([id, e]) => ({
        id,
        short: e.recorder.length,
        cache: e.recorder.getCache().length,
        hasSummary: !!e.recorder.getMidSummary(),
        idleMin: Math.floor((now - e.lastActive) / 60000),
    }));
}

/**
 * 主动结束一个会话：先压缩记忆再移出会话池
 * @returns 会话不存在时返回 false
 */
export async function retireSession(id: string): Promise<boolean> {
    const entry = sessions.get(id);
    if (!entry) return false;
    sessions.delete(id);
    deletePlan(id);
    await safeCompress(entry.recorder, id);
    return true;
}

/**
 * 回收最久未活跃的会话（超出 MAX_SESSIONS 时）
 */
function retireLeastRecent(): void {
    let oldest: [string, SessionEntry] | null = null;
    for (const [id, e] of sessions) {
        if (!oldest || e.lastActive < oldest[1].lastActive) oldest = [id, e];
    }
    if (!oldest) return;
    const [id, entry] = oldest;
    sessions.delete(id);
    deletePlan(id);
    logger.info(`会话数量达上限，回收最不活跃会话: ${id}`);
    safeCompress(entry.recorder, id);
}

/**
 * 回收前压缩记忆，失败只记日志（不阻塞会话池操作）
 */
async function safeCompress(recorder: ChatRecorder, id: string): Promise<void> {
    try {
        await recorder.compress();
    }
    catch (err) {
        logger.error(`会话 ${id} 回收压缩失败:`, err);
    }
}

function sweepIdle(): void {
    const now = Date.now();
    for (const [id, entry] of sessions) {
        if (now - entry.lastActive > IDLE_TTL_MS) {
            sessions.delete(id);
            deletePlan(id);
            logger.info(`会话空闲超时，回收: ${id}`);
            safeCompress(entry.recorder, id);
        }
    }
}

const sweeper = setInterval(sweepIdle, SWEEP_INTERVAL_MS);
sweeper.unref();


