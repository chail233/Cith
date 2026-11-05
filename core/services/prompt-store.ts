/**
 * 系统提示词存储：core/prompts/system.md 是唯一来源
 *
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import config from "../config.js";
import { resolveSrcPath } from "../utils/file-security.js";
import logger from "../utils/logger.js";

/** 未配置 systemPromptPath 时的默认文件（相对 core/） */
const DEFAULT_PROMPT_PATH = "prompts/system.md";

/** 提示词快照（面板用） */
export interface PromptDoc {
    /** 相对 core/ 的文件路径 */
    path: string;
    text: string;
    bytes: number;
    /** 文件最后修改时间（ISO）；文件不存在时为 null */
    updatedAt: string | null;
}

interface CacheEntry {
    mtimeMs: number;
    size: number;
    text: string;
}

const cfg = config as unknown as Record<string, unknown>;

let cache: CacheEntry | null = null;
let missingWarned = false;

/** 提示词文件路径（相对 core/），可由 config.systemPromptPath 覆盖 */
export function promptRelPath(): string {
    const configured = cfg.systemPromptPath;
    const text = typeof configured === "string" ? configured.trim() : "";
    return text === "" ? DEFAULT_PROMPT_PATH : text;
}

function promptFilePath(): string {
    const r = resolveSrcPath(promptRelPath());
    if (r.error) throw new Error(r.error);
    return r.fullPath ?? "";
}

/** 读取文件内容；文件不存在或不可读时返回 null */
function readFileEntry(): CacheEntry | null {
    const file = promptFilePath();
    let stat;
    try {
        stat = statSync(file);
    }
    catch {
        return null;
    }
    if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache;
    try {
        const text = readFileSync(file, "utf8");
        cache = { mtimeMs: stat.mtimeMs, size: stat.size, text };
        return cache;
    }
    catch (err) {
        logger.error(`系统提示词文件读取失败：${promptRelPath()}`, err);
        return null;
    }
}

/**
 * 当前生效的系统提示词
 *
 * 同步实现：Agent 每回合都要构建上下文，文件未变时只是一次 stat + 内存命中。
 * 文件不存在时返回空串，由 contextBuilder 跳过这条 system 消息。
 */
export function readSystemPrompt(): string {
    const entry = readFileEntry();
    if (entry) return entry.text;
    if (!missingWarned) {
        missingWarned = true;
        logger.warn(`系统提示词文件不存在：${promptRelPath()}（本回合不注入系统提示词）`);
    }
    return "";
}

/** 面板读取用的提示词快照 */
export function getPromptDoc(): PromptDoc {
    const entry = readFileEntry();
    const text = entry?.text ?? "";
    return {
        path: promptRelPath(),
        text,
        bytes: Buffer.byteLength(text, "utf8"),
        updatedAt: entry ? new Date(entry.mtimeMs).toISOString() : null,
    };
}

/**
 * 保存提示词到文件
 *
 * @param raw 面板提交的文本
 * @throws 非文本、路径非法或落盘失败时抛错，文案直接展示给面板用户
 */
export function saveSystemPrompt(raw: unknown): PromptDoc {
    if (typeof raw !== "string") throw new Error("提示词必须是文本");
    // BOM 会让首行提示词多出不可见字符；换行统一成 \n，避免 Windows 编辑器写入 \r\n
    const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

    const file = promptFilePath();
    mkdirSync(dirname(file), { recursive: true });
    // 只留一版备份：误存后可直接把 .bak 改回来
    if (existsSync(file)) copyFileSync(file, `${file}.bak`);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, file);
    cache = null;
    missingWarned = false;
    logger.info(`系统提示词已保存：${promptRelPath()}（${Buffer.byteLength(text, "utf8")} 字节），下一回合生效`);
    return getPromptDoc();
}
