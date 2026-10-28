import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import logger from "../utils/logger.js";
import { resolveSrcPath } from "../utils/file-security.js";

/**
 * 定时苏醒调度器
 * - 任务持久化到 data/schedule.json（临时文件 + rename，防写坏）
 * - 单一 setTimeout 指向最近的 nextRun，触发后重排
 * - 单任务互斥：上一轮没跑完就跳过本轮
 * - 关机期间的错过：非一次性任务过期超过 5 分钟直接跳过，不再补刷
 */

const STORE_PATH = "data/schedule.json";
const MAX_DELAY = 2 ** 31 - 1;
const CATCHUP_SKIP_MS = 5 * 60 * 1000;
const ONCE_EXPIRE_MS = 30 * 60 * 1000;
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

let tasks = [];
let timer = null;
let loaded = false;
let onFire = null;
let writeQueue = Promise.resolve();
const running = new Set();

/* ---------------- 时间处理 ---------------- */

export function formatTs(ts) {
    if (typeof ts !== "number" || !Number.isFinite(ts))
        return "—";
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function pad2(n) {
    return String(n).padStart(2, "0");
}

function parseLocalTime(text) {
    if (typeof text !== "string")
        return null;
    const m = text.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
    if (!m)
        return null;
    const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
    const ts = dt.getTime();
    return Number.isNaN(ts) ? null : ts;
}

function parseClock(text) {
    if (typeof text !== "string")
        return null;
    const m = text.trim().match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m)
        return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h < 0 || h > 23 || mi < 0 || mi > 59)
        return null;
    return h * 60 + mi;
}

function parseCronField(field, min, max) {
    const result = new Set();
    for (const part of String(field).split(",")) {
        const [range, stepText] = part.split("/");
        const step = stepText === undefined ? 1 : Number(stepText);
        if (!Number.isInteger(step) || step < 1)
            return null;
        let lo;
        let hi;
        if (range === "*" || range === "?") {
            lo = min;
            hi = max;
        }
        else if (range.includes("-")) {
            const [a, b] = range.split("-").map(Number);
            if (!Number.isInteger(a) || !Number.isInteger(b))
                return null;
            lo = a;
            hi = b;
        }
        else {
            const v = Number(range);
            if (!Number.isInteger(v))
                return null;
            lo = v;
            hi = v;
        }
        if (lo < min || hi > max || lo > hi)
            return null;
        for (let v = lo; v <= hi; v += step)
            result.add(v);
    }
    return result;
}

function parseCron(expr) {
    const fields = String(expr ?? "").trim().split(/\s+/);
    if (fields.length !== 5)
        return null;
    const minute = parseCronField(fields[0], 0, 59);
    const hour = parseCronField(fields[1], 0, 23);
    const dom = parseCronField(fields[2], 1, 31);
    const month = parseCronField(fields[3], 1, 12);
    const dow = parseCronField(fields[4].replace(/7/g, "0"), 0, 6);
    if (!minute || !hour || !dom || !month || !dow)
        return null;
    return { minute, hour, dom, month, dow };
}

function matchCron(cron, date) {
    return cron.minute.has(date.getMinutes())
        && cron.hour.has(date.getHours())
        && cron.dom.has(date.getDate())
        && cron.month.has(date.getMonth() + 1)
        && cron.dow.has(date.getDay());
}

/* ---------------- 规则归一 ---------------- */

export function normalizeSchedule(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const kind = String(raw.kind ?? "").trim().toLowerCase();
    if (kind === "once") {
        const at = parseLocalTime(raw.at ?? raw.time);
        if (at == null)
            return null;
        return { kind: "once", at };
    }
    if (kind === "every") {
        const minutes = Number(raw.everyMinutes ?? raw.minutes);
        if (!Number.isFinite(minutes) || minutes < 1)
            return null;
        return { kind: "every", everyMinutes: Math.max(1, Math.floor(minutes)) };
    }
    if (kind === "daily") {
        const list = Array.isArray(raw.times) ? raw.times : [raw.at ?? raw.time];
        const times = [...new Set(list.map(parseClock).filter((v) => v != null))].sort((a, b) => a - b);
        if (times.length === 0)
            return null;
        return { kind: "daily", times };
    }
    if (kind === "cron") {
        const expr = String(raw.expr ?? raw.cron ?? "").trim();
        if (!parseCron(expr))
            return null;
        return { kind: "cron", expr: expr.split(/\s+/).join(" ") };
    }
    return null;
}

export function describeSchedule(schedule) {
    if (!schedule)
        return "无";
    if (schedule.kind === "once")
        return `一次性 ${formatTs(schedule.at)}`;
    if (schedule.kind === "every")
        return `每 ${schedule.everyMinutes} 分钟`;
    if (schedule.kind === "daily")
        return `每天 ${schedule.times.map((m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`).join("、")}`;
    if (schedule.kind === "cron")
        return `cron ${schedule.expr}`;
    return "无";
}

export function computeNextRun(schedule, from = Date.now()) {
    if (!schedule)
        return null;
    if (schedule.kind === "once")
        return typeof schedule.at === "number" && schedule.at > from ? schedule.at : null;
    if (schedule.kind === "every")
        return from + schedule.everyMinutes * MINUTE;
    if (schedule.kind === "daily") {
        const d = new Date(from);
        const base = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        for (let offset = 0; offset <= 8; offset++) {
            for (const minutes of schedule.times) {
                const ts = base + offset * DAY + minutes * MINUTE;
                if (ts > from)
                    return ts;
            }
        }
        return null;
    }
    if (schedule.kind === "cron") {
        const cron = parseCron(schedule.expr);
        if (!cron)
            return null;
        let ts = Math.floor(from / MINUTE) * MINUTE + MINUTE;
        const limit = ts + 366 * DAY;
        while (ts <= limit) {
            if (matchCron(cron, new Date(ts)))
                return ts;
            ts += MINUTE;
        }
        return null;
    }
    return null;
}

/* ---------------- 任务对象 ---------------- */

function normalizeSpace(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const from = raw.from === "user" ? "user" : raw.from === "group" ? "group" : null;
    const id = raw.id == null ? "" : String(raw.id).trim();
    if (!from || !id)
        return null;
    return { from, id };
}

function normalizeTask(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const space = normalizeSpace(raw.space);
    const schedule = normalizeSchedule(raw.schedule);
    if (!id || !space || !schedule)
        return null;
    return {
        id,
        title: String(raw.title ?? "").slice(0, 100) || "未命名",
        prompt: String(raw.prompt ?? "").slice(0, 2000),
        space,
        schedule,
        enabled: raw.enabled !== false,
        createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
        lastRun: typeof raw.lastRun === "number" ? raw.lastRun : null,
        nextRun: typeof raw.nextRun === "number" ? raw.nextRun : null,
    };
}

function serializeTask(task) {
    return {
        id: task.id,
        title: task.title,
        prompt: task.prompt,
        space: task.space,
        schedule: task.schedule,
        enabled: task.enabled,
        createdAt: task.createdAt,
        lastRun: task.lastRun,
        nextRun: task.nextRun,
    };
}

export function viewTask(task) {
    return {
        id: task.id,
        title: task.title,
        prompt: task.prompt,
        space: `${task.space.from}:${task.space.id}`,
        schedule: describeSchedule(task.schedule),
        enabled: task.enabled,
        running: running.has(task.id),
        nextRun: formatTs(task.nextRun),
        lastRun: formatTs(task.lastRun),
    };
}

function storeFile() {
    const r = resolveSrcPath(STORE_PATH);
    if (r.error)
        throw new Error(r.error);
    return r.fullPath;
}

async function persist() {
    let path;
    try {
        path = storeFile();
    }
    catch (err) {
        logger.error("定时任务存储路径非法:", err);
        return;
    }
    const data = { version: 1, updatedAt: new Date().toISOString(), tasks: tasks.map(serializeTask) };
    writeQueue = writeQueue
        .then(async () => {
        await mkdir(dirname(path), { recursive: true });
        const tmp = `${path}.tmp`;
        await writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
        await rename(tmp, path);
    })
        .catch((err) => logger.error("定时任务保存失败:", err));
    return writeQueue;
}

export async function loadTasks() {
    let raw = null;
    try {
        raw = JSON.parse(await readFile(storeFile(), "utf-8"));
    }
    catch (err) {
        if (err.code !== "ENOENT")
            logger.error("定时任务读取失败:", err);
    }
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.tasks) ? raw.tasks : [];
    tasks = [];
    for (const entry of list) {
        const task = normalizeTask(entry);
        if (!task) {
            logger.warn("定时任务条目非法，已跳过:", entry?.id);
            continue;
        }
        tasks.push(task);
    }
    const now = Date.now();
    for (const task of tasks) {
        if (!task.enabled)
            continue;
        const next = computeNextRun(task.schedule, now);
        task.nextRun = next;
        if (next == null && task.schedule.kind !== "once")
            task.enabled = false;
    }
    loaded = true;
    logger.info(`定时任务已加载：${tasks.length} 个，启用 ${tasks.filter((t) => t.enabled).length} 个`);
    return tasks;
}

/* ---------------- 调度核心 ---------------- */

function clearTimer() {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
}

function scheduleTick() {
    clearTimer();
    let nearest = Infinity;
    const now = Date.now();
    for (const task of tasks) {
        if (!task.enabled)
            continue;
        if (typeof task.nextRun !== "number") {
            task.nextRun = computeNextRun(task.schedule, now);
            void persist();
        }
        if (task.nextRun == null)
            continue;
        if (task.nextRun <= now) {
            void fire(task);
            continue;
        }
        if (task.nextRun < nearest)
            nearest = task.nextRun;
    }
    if (nearest === Infinity)
        return;
    const delay = Math.min(Math.max(nearest - Date.now(), 0), MAX_DELAY);
    timer = setTimeout(() => {
        timer = null;
        scheduleTick();
    }, delay);
    timer.unref?.();
}

async function fire(task) {
    if (!task.enabled || running.has(task.id))
        return { ok: false, reason: "busy" };
    const overdue = Date.now() - (task.nextRun ?? Date.now());
    const isOnce = task.schedule.kind === "once";
    const limit = isOnce ? ONCE_EXPIRE_MS : CATCHUP_SKIP_MS;
    if (overdue > limit) {
        logger.warn(`定时任务错过太久，跳过本次: ${task.id} ${task.title}（迟 ${Math.round(overdue / 60000)} 分钟）`);
        if (isOnce) {
            task.enabled = false;
            task.nextRun = null;
        }
        else {
            task.nextRun = computeNextRun(task.schedule, Date.now());
        }
        await persist();
        scheduleTick();
        return { ok: false, reason: "overdue" };
    }
    running.add(task.id);
    const firedAt = Date.now();
    task.lastRun = firedAt;
    if (isOnce) {
        task.enabled = false;
        task.nextRun = null;
    }
    else {
        task.nextRun = computeNextRun(task.schedule, firedAt);
    }
    void persist();
    logger.info(`定时苏醒触发: ${task.id} ${task.title}（${describeSchedule(task.schedule)}）`);
    try {
        if (onFire)
            await onFire(task);
        return { ok: true };
    }
    catch (err) {
        logger.error("定时任务执行失败:", task.id, err);
        return { ok: false, reason: "error" };
    }
    finally {
        running.delete(task.id);
        scheduleTick();
    }
}

/* ---------------- 对外接口 ---------------- */

export async function startScheduler(options = {}) {
    onFire = typeof options.onFire === "function" ? options.onFire : null;
    if (!loaded)
        await loadTasks();
    scheduleTick();
    logger.info("定时苏醒调度器已启动");
}

export function stopScheduler() {
    clearTimer();
    logger.info("定时苏醒调度器已停止");
}

export function listTasks() {
    return tasks.map(viewTask);
}

export function listTasksSummary() {
    const active = tasks.filter((t) => t.enabled);
    if (active.length === 0)
        return "";
    return active
        .map((t) => `- ${t.id} ${t.title}｜${describeSchedule(t.schedule)}｜下次 ${formatTs(t.nextRun)}｜会话 ${t.space.from}:${t.space.id}`)
        .join("\n");
}

export async function createTask(input) {
    if (!loaded)
        await loadTasks();
    const space = normalizeSpace(input?.space);
    if (!space)
        return { ok: false, error: "缺少或非法的会话（space）" };
    const schedule = normalizeSchedule(input?.schedule);
    if (!schedule)
        return { ok: false, error: "时间规则不合法（kind: once/every/daily/cron）" };
    const next = computeNextRun(schedule, Date.now());
    if (next == null && schedule.kind === "once")
        return { ok: false, error: "一次性任务的时间已经过去了" };
    const task = {
        id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        title: String(input?.title ?? "").trim().slice(0, 100) || "苏醒",
        prompt: String(input?.prompt ?? "").trim().slice(0, 2000),
        space,
        schedule,
        enabled: input?.enabled !== false,
        createdAt: Date.now(),
        lastRun: null,
        nextRun: next,
    };
    tasks.push(task);
    await persist();
    scheduleTick();
    return { ok: true, task: viewTask(task) };
}

export async function removeTask(id) {
    const index = tasks.findIndex((t) => t.id === id);
    if (index < 0)
        return { ok: false, error: `任务 ${id} 不存在` };
    const [removed] = tasks.splice(index, 1);
    await persist();
    scheduleTick();
    return { ok: true, task: viewTask(removed) };
}

export async function setTaskEnabled(id, enabled) {
    const task = tasks.find((t) => t.id === id);
    if (!task)
        return { ok: false, error: `任务 ${id} 不存在` };
    const target = typeof enabled === "boolean" ? enabled : !task.enabled;
    task.enabled = target;
    if (target) {
        task.nextRun = computeNextRun(task.schedule, Date.now());
        if (task.nextRun == null && task.schedule.kind === "once")
            return { ok: false, error: "该一次性任务时间已过，无法再启用", task: viewTask(task) };
    }
    else {
        task.nextRun = null;
    }
    await persist();
    scheduleTick();
    return { ok: true, task: viewTask(task) };
}

export async function runTaskNow(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task)
        return { ok: false, error: `任务 ${id} 不存在` };
    if (running.has(task.id))
        return { ok: false, error: "该任务正在执行中" };
    const snapshot = { ...task };
    running.add(task.id);
    try {
        if (!onFire)
            return { ok: false, error: "调度器未启动，无法执行" };
        await onFire(snapshot);
        task.lastRun = Date.now();
        await persist();
        return { ok: true, task: viewTask(task) };
    }
    catch (err) {
        logger.error("定时任务手动执行失败:", id, err);
        return { ok: false, error: String(err?.message ?? err) };
    }
    finally {
        running.delete(task.id);
    }
}