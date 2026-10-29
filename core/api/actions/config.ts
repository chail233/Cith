/**
 * config action：配置只读查询与受控热改
 */
import config from "../../config.js";
import { registerAction } from "../router.ts";

/** 命中这些键名的值一律脱敏 */
const SENSITIVE_PATTERNS = [
    "apikey", "token", "secret", "password", "key", "pem",
];

/** 允许运行时热改的字段白名单 */
const WRITABLE_KEYS = new Set<string>([
    "targetGroupId",
    "targetUserId",
    "selfId",
    "owner",
    "aiApiKey",
    "visionApiKey",
    "enableProactiveChat",
    "chatHistoryLimit",
    "proactiveChatLimit",
    "llmApiUrl",
    "llmVisionApiUrl",
    "chatModel",
    "visionModel",
    "llmTimeout",
    "repeaterQueueSize",
    "memoryApiBaseUrl",
    "memorySearchTopK",
    "memoryMinScore",
    "toolChainMaxLength",
    "toolOutput",

    "readFileDirs",
    "runJsDirs",
    "editFileDirs",

    "githubToken",

    "systemPrompt",
]);

/** 输出时直接跳过的复杂/巨大字段 */
const SKIP_KEYS = new Set<string>([
    "members",          // Map
    "systemPrompt",     // 巨大提示词文本
]);

function isSensitiveKey(key: string): boolean {
    const k = key.toLowerCase();
    return SENSITIVE_PATTERNS.some((p) => k.includes(p) || k.endsWith(p));
}

/**
 * 值级黑名单：递归收集配置中所有敏感键
 */
function buildSensitiveValues(): Set<string> {
    const values = new Set<string>();
    collectSensitiveValues(config, null, 0, values);
    return values;
}

function collectSensitiveValues(
    value: unknown,
    keyHint: string | null,
    depth: number,
    out: Set<string>,
): void {
    if (depth > 3) return;
    if (keyHint !== null) {
        if (isSensitiveKey(keyHint)) {
            const normalized = normalizeForMask(value);
            if (normalized !== null) out.add(normalized);
            return; // 敏感值本身不再下钻
        }
    }
    if (Array.isArray(value)) {
        for (const v of value) collectSensitiveValues(v, null, depth + 1, out);
    }
    else if (value !== null && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) {
            collectSensitiveValues(v, k, depth + 1, out);
        }
    }
}

/** 提取值中可被匹配的敏感片段；无法结构化提取时返回 null（退化为仅键名脱敏） */
function normalizeForMask(value: unknown): string | null {
    if (typeof value === "string") {
        // "Bearer xxx" 这类前缀值：取最后一段凭证主体
        const token = value.trim().split(/\s+/).pop() ?? "";
        return token.length >= 6 ? token : null;
    }
    if (value && typeof value === "object") {
        // headers/env 里的凭证字段
        const obj = value as Record<string, unknown>;
        for (const inner of [...Object.values(obj)].slice(0, 20)) {
            if (typeof inner === "string" && inner.length >= 6) return inner;
        }
    }
    return null;
}

/** 对单个输出值做黑名单命中遮蔽 */
function maskIfSensitive(value: unknown, sensitiveValues: Set<string>): unknown {
    if (typeof value === "string") {
        return sensitiveValues.has(value.trim().split(/\s+/).pop() ?? "") ? "***" : value;
    }
    if (Array.isArray(value)) {
        return value.map((v) => maskIfSensitive(v, sensitiveValues));
    }
    return value;
}

/** 生成可安全返回给面板的配置快照：键名脱敏 + 值级黑名单 + 嵌套对象/数组过滤 */
function buildConfigSnapshot(): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {};
    const sensitiveValues = buildSensitiveValues();
    for (const [key, value] of Object.entries(config)) {
        if (SKIP_KEYS.has(key)) continue;
        if (typeof value === "function") continue;
        if (isSensitiveKey(key)) {
            // 仅在确有值时标记为已设置
            snapshot[key] = value ? "***" : null;
            continue;
        }
        // 子级可能携带敏感值的对象不输出；数组仅限全部为标量时输出（如 targetUserId），
        if (Array.isArray(value)) {
            if (value.every((v) => v === null || typeof v !== "object")) {
                snapshot[key] = maskIfSensitive(value, sensitiveValues);
            }
        }
        else if (value === null || typeof value !== "object") {
            snapshot[key] = maskIfSensitive(value, sensitiveValues);
        }
    }
    return snapshot;
}

registerAction("get_config", () => buildConfigSnapshot());

registerAction("set_config", (params) => {
    const key = params?.key as string | undefined;
    const value = params?.value;

    if (!key || !Object.prototype.hasOwnProperty.call(config, key)) {
        throw new Error("配置项不存在");
    }
    if (!WRITABLE_KEYS.has(key)) {
        // 白名单外的写入请求直接拒绝，包括任何密钥类
        throw new Error(`该配置项不允许修改: ${key}`);
    }

    // 类型守卫：防止面板把字符串字段写成数字/布尔（如 selfId "123" → 123）导致运行期比较失效
    const current = (config as Record<string, unknown>)[key];
    const typeMismatch = current !== null && current !== undefined
        && (Array.isArray(current) ? !Array.isArray(value) : typeof value !== typeof current);
    if (typeMismatch) {
        throw new Error(`类型不匹配：${key} 需要 ${Array.isArray(current) ? "array" : typeof current} 类型`);
    }

    (config as Record<string, unknown>)[key] = value;
    return { key, value };
});
