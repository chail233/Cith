import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 文件路径安全工具
 * 封装路径解析、穿越防护和白名单校验，供 LLM 工具统一调用
 */

/** core/ 目录的绝对路径（file-security.js 在 core/utils/，回退一级到 core/） */
const baseDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 将相对于 core/ 的路径解析为绝对路径，并检查路径穿越
 * @param {string} filepath 相对于 core/ 的文件路径
 * @returns {{fullPath: string, error?: undefined} | {error: string, fullPath?: undefined}}
 */
export function resolveSrcPath(filepath) {
    const fullPath = resolve(baseDir, filepath);

    // 路径穿越防护：确保解析后的路径仍在 core/ 目录下
    if (fullPath !== baseDir && !fullPath.startsWith(baseDir + sep)) {
        return { error: "非法路径，禁止访问上级目录" };
    }

    return { fullPath };
}

/**
 * 检查路径是否在白名单允许的目录内
 * @param {string} fullPath 文件绝对路径
 * @param {string[]} whitelist 白名单目录列表（相对于 core/）
 * @param {string} operationName 操作名称，用于生成错误提示（如"读取"、"编辑"、"执行"）
 * @returns {{allowed: true} | {error: string}}
 */
export function checkPathWhitelist(fullPath, whitelist, operationName) {
    const allowed = whitelist.some(dir => {
        const allowedDir = resolve(baseDir, dir);
        return fullPath === allowedDir || fullPath.startsWith(allowedDir + sep);
    });

    if (!allowed) {
        return { error: `无权${operationName}该路径，仅允许以下目录：${whitelist.join(", ")}` };
    }

    return { allowed: true };
}

export { baseDir };
