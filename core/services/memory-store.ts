/**
 * 长期记忆存储服务（rememori 嵌入式语义记忆）
 *
 */
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Memory } from "rememori";
import { ollama, openai } from "rememori/embedders";
import config from "../config.js";
import logger from "../utils/logger.js";
import { resolveSrcPath } from "../utils/file-security.js";

/** 单例；null 表示未启用或初始化失败，上层据此跳过长期记忆 */
let store: Memory | null = null;
/** 并发调用 init 时共享同一个初始化 Promise */
let opening: Promise<Memory | null> | null = null;
/** 写操作串行链 */
let writeChain: Promise<unknown> = Promise.resolve();
/** 距上次维护的写入次数 */
let writesSinceMaintain = 0;
/** 是否有维护正在执行，避免重复排队 */
let maintaining = false;

/** 当前记忆实例 */
export function getMemoryStore(): Memory | null {
    return store;
}

/** 给 Promise 套一层超时，避免 Ollama 无响应时卡住对话链路 */
function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
    });
    return Promise.race([task, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/** 是否使用 OpenAI 兼容 HTTP 接口做 embedding（而非本地 Ollama） */
function useApiEmbedder(): boolean {
    return String(config.memoryEmbedProvider ?? "ollama").trim().toLowerCase() === "openai";
}

/** OpenAI 兼容接口的 baseUrl（未配置时退回 OpenAI 官方地址） */
function apiEmbedderBaseUrl(): string {
    const raw = String(config.memoryEmbedBaseUrl ?? "").trim();
    return (raw || "https://api.openai.com/v1").replace(/\/+$/, "");
}

/** 探测本地 Ollama 是否可用，并提示缺失的 embedding 模型；返回不可用的原因 */
async function checkOllamaEmbedder(): Promise<string | null> {
    const baseUrl = String(config.memoryOllamaUrl).replace(/\/+$/, "");
    try {
        const resp = await withTimeout(fetch(`${baseUrl}/api/tags`), config.memoryTimeout, "Ollama 探测");
        if (!resp.ok) return `Ollama 返回 HTTP ${resp.status}`;
        const body = await resp.json() as { models?: Array<{ name?: string }> };
        const names = (body.models ?? []).map((m) => m.name ?? "");
        const model = String(config.memoryEmbedModel);
        const present = names.some((name) => name === model || name.startsWith(`${model}:`));
        if (!present) {
            return `Ollama 中没有模型 ${model}，请先执行 ollama pull ${model}`;
        }
        return null;
    }
    catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return `无法连接 Ollama（${baseUrl}）：${detail}`;
    }
}

/** 探测 OpenAI 兼容 embedding 接口：直接发一次最小请求，同时验证地址/密钥/模型 */
async function checkApiEmbedder(): Promise<string | null> {
    if (!String(config.memoryEmbedApiKey ?? "").trim()) {
        return "memoryEmbedProvider=openai 但未配置 memoryEmbedApiKey";
    }
    const baseUrl = apiEmbedderBaseUrl();
    try {
        const resp = await withTimeout(fetch(`${baseUrl}/embeddings`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${String(config.memoryEmbedApiKey ?? "")}`,
            },
            body: JSON.stringify({ model: config.memoryEmbedModel, input: ["ping"] }),
        }), config.memoryTimeout, "embedding 接口探测");
        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            return `embedding 接口返回 HTTP ${resp.status}${text ? `：${text.slice(0, 160)}` : ""}`;
        }
        const body = await resp.json() as { data?: Array<{ embedding?: unknown }> };
        const dim = Array.isArray(body.data?.[0]?.embedding)
            ? (body.data[0].embedding as unknown[]).length
            : 0;
        if (!dim) return "embedding 接口返回格式异常（缺少 data[0].embedding）";
        return null;
    }
    catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return `无法连接 embedding 接口（${baseUrl}）：${detail}`;
    }
}

/** 按配置探测 embedding 提供方是否可用；返回不可用的原因 */
function checkEmbedder(): Promise<string | null> {
    return useApiEmbedder() ? checkApiEmbedder() : checkOllamaEmbedder();
}

/**
 * 启动记忆存储；未启用/初始化失败时返回 null，不影响主流程
 */
export async function initMemoryStore(): Promise<Memory | null> {
    if (!config.enableLongTermMemory) {
        logger.info("长期记忆未启用（enableLongTermMemory=false）");
        return null;
    }
    if (store) return store;
    if (opening) return opening;

    opening = (async () => {
        const resolved = resolveSrcPath(config.memoryStorePath);
        if (resolved.error || !resolved.fullPath) {
            logger.warn("长期记忆存储路径非法，已跳过:", resolved.error ?? config.memoryStorePath);
            return null;
        }

        const problem = await checkEmbedder();
        if (problem) {
            logger.warn("长期记忆初始化中止:", problem);
            return null;
        }

        try {
            await mkdir(dirname(resolved.fullPath), { recursive: true });
            const embedder = useApiEmbedder()
                ? openai(config.memoryEmbedModel, {
                    apiKey: String(config.memoryEmbedApiKey ?? ""),
                    baseUrl: String(config.memoryEmbedBaseUrl ?? "").trim() || undefined,
                })
                : ollama(config.memoryEmbedModel, { baseUrl: config.memoryOllamaUrl });
            const mem = await Memory.open(resolved.fullPath, {
                embedder,
                // 内置实体抽取是大写首字母启发式，对中文无效；直接关闭实体图
                extractor: false,
                index: "auto",
                minSimilarity: config.memoryMinSimilarity,
            });
            store = mem;
            logger.info(
                `长期记忆已就绪: ${config.memoryStorePath}` +
                `（${mem.size} 条，embedding=${config.memoryEmbedModel}@${useApiEmbedder() ? "api" : "ollama"}）`,
            );
            return mem;
        }
        catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            logger.warn("长期记忆初始化失败，本次运行将不使用长期记忆:", detail);
            return null;
        }
    })();

    return opening;
}

/**
 * 串行执行写操作（remember/forget/prune/compact），只排入队列不计数
 */
function runWrite<T>(task: () => Promise<T>): Promise<T> {
    const next = writeChain.then(task, task);
    writeChain = next.catch(() => undefined);
    return next;
}

/** 写入次数达到阈值时触发一次维护（不阻塞调用方） */
function maybeMaintain(): void {
    const limit = config.memoryMaintainEveryWrites;
    if (maintaining || !(limit > 0) || writesSinceMaintain < limit) return;
    writesSinceMaintain = 0;
    void maintainMemoryStore();
}

/**
 * 串行执行写操作（remember/forget/prune/compact），返回本次任务结果；
 * 每成功写入 memoryMaintainEveryWrites 条自动维护一次
 *
 * 注意：调用方超时放弃等待时，队列仍会等本次写真实结束再跑下一条，
 * 避免超时后的新写入与上一次写入并发改动同一个文件（rememori 无文件锁）
 */
export function enqueueMemoryWrite<T>(task: () => Promise<T>): Promise<T> {
    const next = runWrite(task);
    next.then(
        () => {
            writesSinceMaintain += 1;
            maybeMaintain();
        },
        () => undefined,
    );
    return next;
}

/** 维护：清理过期/低重要度记忆并折叠 tombstone（启动时 + 每写满固定次数时执行） */
export async function maintainMemoryStore(): Promise<void> {
    const mem = store;
    if (!mem || maintaining) return;
    maintaining = true;
    try {
        await runWrite(async () => {
            const removed = await mem.prune({ olderThan: "100d", belowImportance: 0.2 });
            if (removed > 0) {
                logger.info(`长期记忆维护：清理 ${removed} 条，当前 ${mem.size} 条`);
            }
        });
    }
    catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        logger.warn("长期记忆维护失败:", detail);
    }
    finally {
        maintaining = false;
    }
}

/** 等待写队列清空；超过 maxMs 主动放弃，避免 Ollama 卡死时阻塞进程退出 */
async function drainWriteChain(maxMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            writeChain,
            new Promise<void>((resolve) => {
                timer = setTimeout(resolve, maxMs);
            }),
        ]);
    }
    finally {
        clearTimeout(timer);
    }
}

/** 关闭存储 */
export async function closeMemoryStore(): Promise<void> {
    const mem = store;
    store = null;
    opening = null;
    if (!mem) return;
    try {
        await drainWriteChain(3000);
        await mem.close();
        logger.info("长期记忆已关闭");
    }
    catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        logger.warn("长期记忆关闭失败:", detail);
    }
}
