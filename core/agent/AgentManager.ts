/**
 * Agent 会话池
 */
import { ChatRecorder } from "./recorder.js";
import logger from "../utils/logger.js";
import { deletePlan } from "./plan.ts";
import Agent from "./Agent.ts";
import type { Space } from "../types/index.ts";

/** 空闲超过该时长的会话会被回收（先压缩记忆） */
const IDLE_TTL_MS = 30 * 60 * 1000;
/** 回收扫描间隔 */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
/** 会话数量上限，超出时按最久未活跃回收（防止内存无限增长） */
const MAX_SESSIONS = 50;

interface AgentEntry {
    agent: Agent;
    lastActive: number;
}

export interface AgentInfo {
    id: string;
    short: number;
    cache: number;
    hasSummary: boolean;
    idleMin: number;
}

const agents = new Map<string, AgentEntry>();

/**
 * 由消息空间生成会话 ID
 */
export function sessionIdOf(space: Space): string {
    return `${space.from}:${space.id}`;
}


export function getAgent(space: Space): Agent {
    const id = sessionIdOf(space);
    let entry = agents.get(id);
    if (!entry) {
        if (agents.size >= MAX_SESSIONS) {
            retireLeastRecent();
        }
        entry = { agent: new Agent({ sessionId: id, memory: new ChatRecorder(undefined, id) }), lastActive: Date.now() };
        agents.set(id, entry);
        logger.debug(`新建 Agent 会话: ${id}`);
    }
    entry.lastActive = Date.now();
    return entry.agent;
}

/**
 * 会话概览列表
 */
export function listAgents(): AgentInfo[] {
    const now = Date.now();
    return [...agents.entries()].map(([id, e]) => ({
        id,
        short: e.agent.memory.length,
        cache: e.agent.memory.getCache().length,
        hasSummary: !!e.agent.memory.getMidSummary(),
        idleMin: Math.floor((now - e.lastActive) / 60000),
    }));
}

/**
 * 主动结束一个会话：先压缩记忆再移出会话池
 * @returns 会话不存在时返回 false
 */
export async function retireSession(id: string): Promise<boolean> {
    const entry = agents.get(id);
    if (!entry) return false;
    agents.delete(id);
    deletePlan(id);
    await safeCompress(entry, id);
    return true;
}

/**
 * 回收最久未活跃的会话
 */
function retireLeastRecent(): void {
    let oldest: [string, AgentEntry] | null = null;
    for (const [id, e] of agents) {
        if (!oldest || e.lastActive < oldest[1].lastActive) oldest = [id, e];
    }
    if (!oldest) return;
    const [id, entry] = oldest;
    agents.delete(id);
    deletePlan(id);
    logger.info(`会话数量达上限，回收最不活跃会话: ${id}`);
    safeCompress(entry, id);
}

/**
 * 回收前压缩记忆，失败只记日志（不阻塞会话池操作）
 */
async function safeCompress(entry: AgentEntry, id: string): Promise<void> {
    try {
        await entry.agent.memory.compress();
    }
    catch (err) {
        logger.error(`会话 ${id} 回收压缩失败:`, err);
    }
}

function sweepIdle(): void {
    const now = Date.now();
    for (const [id, entry] of agents) {
        if (now - entry.lastActive > IDLE_TTL_MS) {
            agents.delete(id);
            deletePlan(id);
            logger.info(`会话空闲超时，回收: ${id}`);
            safeCompress(entry, id);
        }
    }
}

const sweeper = setInterval(sweepIdle, SWEEP_INTERVAL_MS);
sweeper.unref();
