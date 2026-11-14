import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 文件路径安全工具
 * 封装路径解析与穿越防护，供内部服务与 run_shell 的 cwd 解析使用
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

export { baseDir };
