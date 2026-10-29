/**
 * 表情包模块：加载索引（manifest）并按标签检索
 *
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveSrcPath } from "../utils/file-security.js";
import logger from "../utils/logger.js";
import config from "../config.js";

/** 默认索引文件位置（相对 core/），模块自包含 */
export const DEFAULT_MANIFEST_PATH = "stickers/manifest.json";
export const DEV_MANIFEST_PATH = "stickers/manifest.dev.json";
/** 默认表情包根目录（相对 core/），manifest 未指定 baseDir 时使用 */
export const DEFAULT_BASE_DIR = "stickers/images";
/** 查询默认返回条数 */
export const DEFAULT_LIMIT = 10;
/** 查询条数上限，防止把整库倒给模型 */
export const MAX_LIMIT = 50;

/** 索引缓存：manifestPath -> { mtimeMs, manifest } */
const cache = new Map();

/**
 * 解析本次应使用的索引路径：显式传入优先，否则按运行模式选择
 * 开发模式读 manifest.dev.json，生产模式读 manifest.json
 * @returns {string} 相对 core/ 的索引路径
 */
export function resolveManifestPath() {
    if (!config.devMode)
        return DEFAULT_MANIFEST_PATH;
    const resolved = resolveSrcPath(DEV_MANIFEST_PATH);
    if (!resolved.error && existsSync(resolved.fullPath))
        return DEV_MANIFEST_PATH;
    logger.warn(`开发模式未找到 ${DEV_MANIFEST_PATH}，回退到 ${DEFAULT_MANIFEST_PATH}`);
    return DEFAULT_MANIFEST_PATH;
}

/**
 * 读取并归一化索引
 * @param {{ manifestPath?: string, force?: boolean }} [options]
 * @returns {StickerManifest}
 */
export function loadManifest(options = {}) {
    const manifestPath = options.manifestPath ?? resolveManifestPath();
    const resolved = resolveSrcPath(manifestPath);
    if (resolved.error) {
        logger.error("表情包索引路径非法:", resolved.error);
        return emptyManifest();
    }
    let mtimeMs = 0;
    try {
        mtimeMs = statSync(resolved.fullPath).mtimeMs;
    }
    catch (err) {
        logger.warn(`表情包索引读取失败(${manifestPath}):`, err.message);
        return emptyManifest();
    }
    const cached = cache.get(manifestPath);
    if (!options.force && cached && cached.mtimeMs === mtimeMs) {
        return cached.manifest;
    }
    let raw;
    try {
        raw = JSON.parse(readFileSync(resolved.fullPath, "utf-8"));
    }
    catch (err) {
        logger.error(`表情包索引解析失败(${manifestPath}):`, err.message);
        return emptyManifest();
    }
    const manifest = normalizeManifest(raw, manifestPath);
    cache.set(manifestPath, { mtimeMs, manifest });
    logger.debug(`表情包索引已加载：${manifest.items.length} 条，标签 ${manifest.vocabulary.length} 个`);
    return manifest;
}

/** 清空索引缓存，传路径则只清该文件 */
export function clearManifestCache(manifestPath) {
    if (manifestPath) {
        cache.delete(manifestPath);
        return;
    }
    cache.clear();
}

/**
 * 列出所有标签及出现次数，供模型了解可用的标签词表
 */
export function listTags(options = {}) {
    const manifest = loadManifest(options);
    const counter = new Map();
    for (const item of manifest.items) {
        for (const tag of item.tags) {
            counter.set(tag, (counter.get(tag) ?? 0) + 1);
        }
    }
    for (const tag of manifest.vocabulary) {
        if (!counter.has(tag))
            counter.set(tag, 0);
    }
    return [...counter.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * 按标签检索候选表情包
 */
export function queryStickers(query = {}, options = {}) {
    const manifest = loadManifest(options);
    const tags = normalizeTags(query.tags ?? []);
    const limit = clampLimit(query.limit);
    const exclude = new Set(query.excludeIds ?? []);
    const matched = [];
    for (const item of manifest.items) {
        if (exclude.has(item.id))
            continue;
        let hits = 0;
        for (const tag of tags) {
            if (item.tags.includes(tag))
                hits += 1;
        }
        if (tags.length > 0 && hits === 0)
            continue;
        // 命中数优先，其次按权重微调，最后加随机扰动避免每次都挑同一张
        const score = hits + (item.weight - 1) * 0.05 + Math.random() * 0.6;
        matched.push({ score, item });
    }
    matched.sort((a, b) => b.score - a.score);
    return matched.slice(0, limit).map(({ item }) => ({
        id: item.id,
        desc: item.desc,
        tags: item.tags,
    }));
}


/**
 * 按 id 取完整条目，附上可直接发送的绝对路径
 */
export function getSticker(id, options = {}) {
    if (!id)
        return null;
    const manifest = loadManifest(options);
    const item = manifest.items.find((it) => it.id === id);
    if (!item) {
        logger.warn("表情包 id 不存在:", id);
        return null;
    }
    const fullPath = resolveStickerFile(item, manifest.baseDir);
    if (!fullPath) {
        logger.warn("表情包文件路径非法:", item.id, item.file);
        return null;
    }
    return { ...item, path: fullPath };
}

/**
 * 把条目里的相对路径拼到 baseDir 下，并做一次越界校验
 */
function resolveStickerFile(item, baseDir) {
    const resolved = resolveSrcPath(join(baseDir, item.file));
    if (resolved.error)
        return null;
    return resolved.fullPath;
}

/** 归一化并校验索引，非法条目逐条丢弃并告警 */
function normalizeManifest(raw, manifestPath) {
    if (!isPlainObject(raw) || !Array.isArray(raw.items)) {
        logger.error(`表情包索引格式不合法(${manifestPath})：缺少 items 数组`);
        return emptyManifest();
    }
    const version = Number.isInteger(raw.version) ? raw.version : 1;
    const baseDir = typeof raw.baseDir === "string" && raw.baseDir.trim() !== ""
        ? raw.baseDir.trim()
        : DEFAULT_BASE_DIR;
    const vocabulary = normalizeTags(raw.vocabulary ?? []);
    const seen = new Set();
    const items = [];
    raw.items.forEach((entry, index) => {
        const item = normalizeItem(entry);
        if (!item) {
            logger.warn(`表情包索引第 ${index + 1} 条不合法，已跳过`);
            return;
        }
        if (seen.has(item.id)) {
            logger.warn(`表情包 id 重复，已跳过: ${item.id}`);
            return;
        }
        for (const tag of item.tags) {
            if (vocabulary.length > 0 && !vocabulary.includes(tag)) {
                logger.warn(`标签不在词表内: ${tag}（${item.id}）`);
            }
        }
        seen.add(item.id);
        items.push(item);
    });
    return { version, baseDir, vocabulary, items };
}

/** 校验单条表情包条目 */
function normalizeItem(raw) {
    if (!isPlainObject(raw))
        return null;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const file = typeof raw.file === "string" ? raw.file.trim() : "";
    const desc = typeof raw.desc === "string" ? raw.desc.trim() : "";
    if (!id || !file || !desc)
        return null;
    // 只允许相对路径，禁止绝对路径与上级目录
    if (file.startsWith("/") || file.split(/[\\/]/).includes(".."))
        return null;
    const weight = Number(raw.weight);
    return {
        id,
        file,
        desc,
        tags: normalizeTags(raw.tags ?? []),
        weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
    };
}

/** 标签归一化：字符串化、去空白、去重、保序 */
function normalizeTags(tags) {
    if (!Array.isArray(tags))
        return [];
    const out = [];
    for (const tag of tags) {
        if (typeof tag !== "string")
            continue;
        const t = tag.trim();
        if (!t || out.includes(t))
            continue;
        out.push(t);
    }
    return out;
}

function clampLimit(limit) {
    const n = Number(limit);
    if (!Number.isFinite(n) || n <= 0)
        return DEFAULT_LIMIT;
    return Math.min(Math.floor(n), MAX_LIMIT);
}

function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyManifest() {
    return { version: 1, baseDir: DEFAULT_BASE_DIR, vocabulary: [], items: [] };
}

/**
 * @typedef {Object} StickerItem
 * @property {string} id
 * @property {string} file 相对 baseDir 的路径
 * @property {string} desc 给模型看的画面/情绪描述
 * @property {string[]} tags
 * @property {number} weight 命中权重，默认 1
 */

/**
 * @typedef {Object} StickerManifest
 * @property {number} version
 * @property {string} baseDir
 * @property {string[]} vocabulary
 * @property {StickerItem[]} items
 */

/**
 * @typedef {Object} StickerCandidate
 * @property {string} id
 * @property {string} desc
 * @property {string[]} tags
 */

/**
 * @typedef {StickerItem & { path: string }} StickerResolved
 */

/**
 * @typedef {Object} StickerOptions
 * @property {string} [manifestPath]
 * @property {boolean} [force]
 */