/**
 * 模型 Token 用量统计
 */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import logger from "../utils/logger.js";
import { resolveSrcPath } from "../utils/file-security.js";

const STORE_PATH = "data/token-usage.json";
/** 分天记录保留窗口（天），超出后最旧的天被裁剪，「累计」随之只统计窗口内数据 */
const KEEP_DAYS = 90;

/** 单模型用量细分 */
export interface ModelUsage {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    totalTokens: number;
}

/** 一个统计桶（某一天） */
export interface UsageBucket extends ModelUsage {
    /** 本地日期 YYYY-MM-DD */
    date: string;
    models: Record<string, ModelUsage>;
}

/** 一次模型调用解析出的用量 */
export interface LlmUsage {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    totalTokens: number;
}

interface UsageState {
    version: number;
    updatedAt: string;
    days: UsageBucket[];
}

let state: UsageState = { version: 1, updatedAt: "", days: [] };
/** 首次加载的去重 Promise：并发 recordUsage 时必须等同一个加载完成，否则后到更新会被加载结果覆盖 */
let loadPromise: Promise<void> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

/** 本地日期键 YYYY-MM-DD */
function todayKey(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function storeFile(): string {
    const r = resolveSrcPath(STORE_PATH);
    if (r.error) throw new Error(r.error);
    return r.fullPath??"";
}

/** 数值字段归一化：非有限数一律按 0 处理，防脏数据污染累加 */
function sanitize(n: unknown): number {
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

function emptyBucket(date: string): UsageBucket {
    return { date, requests: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0, models: {} };
}

function doLoad(): Promise<void> {
    return (async () => {
        try {
            const raw = JSON.parse(await readFile(storeFile(), "utf-8")) as Partial<UsageState>;
            if (Array.isArray(raw.days)) {
                state = {
                    version: 1,
                    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
                    days: raw.days
                        .filter((d) => d && typeof d.date === "string")
                        .map((d) => ({
                            ...emptyBucket(d.date),
                            requests: sanitize(d.requests),
                            inputTokens: sanitize(d.inputTokens),
                            outputTokens: sanitize(d.outputTokens),
                            cachedTokens: sanitize(d.cachedTokens),
                            totalTokens: sanitize(d.totalTokens),
                            models: d.models ?? {},
                        })),
                };
            }
        }
        catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code !== "ENOENT") logger.error("Token 用量读取失败:", err);
        }
        // 顺便裁剪超窗口的旧数据
        prune();
    })();
}

/** 加载持久化数据 */
function load(): Promise<void> {
    loadPromise ??= doLoad();
    return loadPromise;
}

function prune(): void {
    const cutoff = todayKey();
    state.days = state.days
        .filter((d) => d.date <= cutoff) // 系统时间回拨产生的未来日期也丢弃
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .slice(-KEEP_DAYS);
}

/** 串行队列 + tmp/rename 原子落盘，避免并发写坏文件 */
function persist(): Promise<void> {
    const data: UsageState = { version: 1, updatedAt: new Date().toISOString(), days: state.days };
    writeQueue = writeQueue
        .then(async () => {
            const path = storeFile();
            await mkdir(dirname(path), { recursive: true });
            const tmp = `${path}.tmp`;
            await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
            await rename(tmp, path);
        })
        .catch((err) => logger.error("Token 用量保存失败:", err));
    return writeQueue;
}

/**
 * 记录一次模型调用的用量
 */
export function recordUsage(usage: LlmUsage): void {
    void load().then(() => {
        const today = todayKey();
        let bucket = state.days.find((d) => d.date === today);
        if (!bucket) {
            bucket = emptyBucket(today);
            state.days.push(bucket);
            prune();
        }
        bucket.requests += 1;
        bucket.inputTokens += usage.inputTokens;
        bucket.outputTokens += usage.outputTokens;
        bucket.cachedTokens += usage.cachedTokens;
        bucket.totalTokens += usage.totalTokens;

        const m = (bucket.models[usage.model] ??= {
            requests: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0,
        });
        m.requests += 1;
        m.inputTokens += usage.inputTokens;
        m.outputTokens += usage.outputTokens;
        m.cachedTokens += usage.cachedTokens;
        m.totalTokens += usage.totalTokens;

        void persist();
    }).catch((err) => logger.error("Token 用量记录失败:", err));
}

/** 累计字段求和的公共实现 */
function sumDays(days: UsageBucket[]): ModelUsage {
    const total: ModelUsage = { requests: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0 };
    for (const d of days) {
        total.requests += d.requests;
        total.inputTokens += d.inputTokens;
        total.outputTokens += d.outputTokens;
        total.cachedTokens += d.cachedTokens;
        total.totalTokens += d.totalTokens;
    }
    return total;
}

/** 去掉 models 明细的对外桶 */
function toPlainBucket(d: UsageBucket): UsageBucket {
    return { ...d };
}

/**
 * 查询用量汇总
 * @param days 最近 N 天的分天记录（按日期升序）
 * @returns today 今日桶 / recent 分天记录 / total 保留窗口内的累计
 */
export async function getUsageSummary(days = 7): Promise<{
    today: UsageBucket;
    recent: UsageBucket[];
    total: ModelUsage;
}> {
    await load();
    const today = todayKey();
    const todayBucket = state.days.find((d) => d.date === today) ?? emptyBucket(today);
    const recent = state.days.slice(-Math.max(1, Math.min(days, KEEP_DAYS))).map(toPlainBucket);
    return { today: toPlainBucket(todayBucket), recent, total: sumDays(state.days) };
}
