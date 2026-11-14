/**
 * 模型价格表：把 token 用量折算成金额
 *
 */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import logger from "../utils/logger.js";
import { resolveSrcPath } from "../utils/file-security.js";

const STORE_PATH = "data/model-pricing.json";
/** 计价币种与单位，仅用于面板展示，不做换算 */
const CURRENCY = "CNY";
const UNIT = "per_million_tokens";
/** 价格表条数上限：防止误粘贴整张价目表把文件撑大 */
const MAX_MODELS = 200;
/** 单价上限（元/百万 tokens）：拦住明显输错的位数（如多打了个 0） */
const MAX_PRICE = 1_000_000;
/** JSON 里能污染原型的键名，一律拒绝 */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** 单个模型的单价（元 / 百万 tokens） */
export interface ModelPrice {
    /** 未命中缓存的输入单价 */
    input: number;
    /** 缓存命中的输入单价；未配置时按 input 计（不假设服务商有折扣） */
    cachedInput: number;
    /** 输出单价 */
    output: number;
}

/** 一次调用的 token 计数（只取计价需要的三个字段） */
export interface TokenCounts {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
}

/** 价格表快照（对外返回） */
export interface PricingSnapshot {
    /** 币种，固定 CNY */
    currency: string;
    /** 单位，固定 per_million_tokens */
    unit: string;
    models: Record<string, ModelPrice>;
}

/** 折算结果：已定价部分金额 + 价格表里缺失的模型 */
export interface CostResult {
    /** 已定价部分的金额（元）；全部未定价时为 0 */
    cost: number;
    /** 用量里出现但价格表中没有的模型名 */
    unpricedModels: string[];
}

let models: Record<string, ModelPrice> = {};
/** 首次加载的去重 Promise：并发读取只需真正读一次文件 */
let loadPromise: Promise<void> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function storeFile(): string {
    const r = resolveSrcPath(STORE_PATH);
    if (r.error) throw new Error(r.error);
    return r.fullPath ?? "";
}

/** 单价解析：接受数字或数字字符串，非法值返回 null */
function toPriceNumber(value: unknown): number | null {
    const n = typeof value === "number"
        ? value
        : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
    if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE) return null;
    return n;
}

/**
 * 归一化价格表：逐条校验，报错文案直接给到面板用户
 * @throws 任一条目不合法时抛错
 */
function normalizeModels(raw: unknown): Record<string, ModelPrice> {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("models 必须是「模型名 → 价格」的对象");
    }
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > MAX_MODELS) throw new Error(`模型条数超过上限 ${MAX_MODELS}`);

    const result: Record<string, ModelPrice> = {};
    for (const [rawName, value] of entries) {
        const name = rawName.trim();
        if (name === "" || FORBIDDEN_KEYS.has(name)) throw new Error(`非法的模型名：${rawName}`);
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
            throw new Error(`模型 ${name} 的价格必须是 { input, cachedInput, output } 对象`);
        }
        const obj = value as Record<string, unknown>;
        const input = toPriceNumber(obj.input);
        if (input === null) throw new Error(`模型 ${name} 的 input 无效（需要 0~${MAX_PRICE} 的数字）`);
        const output = toPriceNumber(obj.output);
        if (output === null) throw new Error(`模型 ${name} 的 output 无效（需要 0~${MAX_PRICE} 的数字）`);
        // 缓存价留空 → 与输入同价，宁可高估也不凭空给折扣
        const cachedRaw = obj.cachedInput;
        const cachedInput = cachedRaw === undefined || cachedRaw === null || cachedRaw === ""
            ? input
            : toPriceNumber(cachedRaw);
        if (cachedInput === null) throw new Error(`模型 ${name} 的 cachedInput 无效（需要 0~${MAX_PRICE} 的数字）`);
        result[name] = { input, cachedInput, output };
    }
    return result;
}

function doLoad(): Promise<void> {
    return (async () => {
        try {
            const raw = JSON.parse(await readFile(storeFile(), "utf-8")) as { models?: unknown };
            models = normalizeModels(raw?.models ?? {});
        }
        catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            // 文件损坏/条目非法时按"全部未定价"运行，不让统计链路连带失败
            if (code !== "ENOENT") logger.error("模型价格表读取失败（按未定价处理）:", err);
        }
    })();
}

function load(): Promise<void> {
    loadPromise ??= doLoad();
    return loadPromise;
}

/** 串行队列 + tmp/rename 原子落盘，避免并发写坏文件 */
function persist(): Promise<void> {
    const data = {
        version: 1,
        updatedAt: new Date().toISOString(),
        currency: CURRENCY,
        unit: UNIT,
        models,
    };
    writeQueue = writeQueue
        .then(async () => {
            const path = storeFile();
            await mkdir(dirname(path), { recursive: true });
            const tmp = `${path}.tmp`;
            await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
            await rename(tmp, path);
        })
        .catch((err) => logger.error("模型价格表保存失败:", err));
    return writeQueue;
}

/** 确保价格表已从磁盘载入（costOfModels 依赖内存态，调用前需先 await 一次） */
export function loadPricing(): Promise<void> {
    return load();
}

/** 读取价格表快照（深拷贝，避免调用方改到运行期状态） */
export async function getPricingSnapshot(): Promise<PricingSnapshot> {
    await load();
    const copy: Record<string, ModelPrice> = {};
    for (const [name, price] of Object.entries(models)) copy[name] = { ...price };
    return { currency: CURRENCY, unit: UNIT, models: copy };
}

/**
 * 整体替换价格表并落盘
 * @param raw 面板提交的 { 模型名: { input, cachedInput?, output } }
 * @throws 校验失败或落盘失败时抛错，由 action 转成面板可见的错误
 */
export async function setPricingModels(raw: unknown): Promise<PricingSnapshot> {
    const next = normalizeModels(raw);
    await load();
    models = next;
    await persist();
    return getPricingSnapshot();
}

/** 数值归一化：非有限数一律按 0，防脏数据把金额算成 NaN */
function num(n: unknown): number {
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

/** 单条用量的金额（元）：输入按缓存命中拆分计价 */
export function costOfUsage(usage: TokenCounts, price: ModelPrice): number {
    const input = num(usage.inputTokens);
    // 服务商的 cachedTokens 属于 inputTokens 的子集，超出时按 input 封顶
    const cached = Math.min(num(usage.cachedTokens), input);
    const miss = input - cached;
    return (miss * price.input + cached * price.cachedInput + num(usage.outputTokens) * price.output) / 1_000_000;
}

/**
 * 按模型折算一组用量的金额
 * @param usages 模型名 → token 计数
 * @returns 已定价部分合计金额 + 未定价模型名
 */
export function costOfModels(usages: Record<string, TokenCounts>): CostResult {
    let cost = 0;
    const unpricedModels: string[] = [];
    for (const [name, usage] of Object.entries(usages)) {
        const price = models[name];
        if (!price) {
            unpricedModels.push(name);
            continue;
        }
        cost += costOfUsage(usage, price);
    }
    return { cost, unpricedModels: unpricedModels.sort() };
}
