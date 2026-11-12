/**
 * 系统提示词存储：core/prompts/system.md 是唯一来源
 *
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveSrcPath } from "../utils/file-security.js";
import logger from "../utils/logger.js";

/** 提示词文件（相对 core/） */
export const PROMPT_REL_PATH = "prompts/system.md";

/** 提示词快照（面板用） */
export interface PromptDoc {
    /** 相对 core/ 的文件路径 */
    path: string;
    text: string;
    bytes: number;
    /** 文件最后修改时间（ISO）；文件不存在时为 null */
    updatedAt: string | null;
}

let missingWarned = false;

function promptFilePath(): string {
    const r = resolveSrcPath(PROMPT_REL_PATH);
    if (r.error) throw new Error(r.error);
    return r.fullPath ?? "";
}

/** 读文件内容；不存在或不可读时返回 null */
function readPromptText(): string | null {
    try {
        return readFileSync(promptFilePath(), "utf8");
    }
    catch {
        if (!missingWarned) {
            missingWarned = true;
            logger.warn(`系统提示词文件不存在或不可读：${PROMPT_REL_PATH}（本回合不注入系统提示词）`);
        }
        return null;
    }
}

/**
 * 当前生效的系统提示词
 *
 * 文件不存在时返回空串，由 Agent.buildMessages 跳过这条 system 消息。
 */
export function readSystemPrompt(): string {
    return readPromptText() ?? "";
}

/** 面板读取用的提示词快照 */
export function getPromptDoc(): PromptDoc {
    const text = readPromptText() ?? "";
    let updatedAt: string | null = null;
    try {
        updatedAt = new Date(statSync(promptFilePath()).mtimeMs).toISOString();
    }
    catch {
    }
    return { path: PROMPT_REL_PATH, text, bytes: Buffer.byteLength(text, "utf8"), updatedAt };
}

/**
 * 保存提示词到文件
 *
 * @param raw 面板提交的文本
 * @throws 非文本或落盘失败时抛错，文案直接展示给面板用户
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
    missingWarned = false;
    logger.info(`系统提示词已保存：${PROMPT_REL_PATH}（${Buffer.byteLength(text, "utf8")} 字节），下一回合生效`);
    return getPromptDoc();
}
