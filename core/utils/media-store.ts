/**
 * 媒体文件落地
 * 收到平台侧的图片/语音时写进 core/ 下的目录，供识图、转写与后续回听使用
 */
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { resolveSrcPath } from "./file-security.js";

/**
 * 把二进制写进 core/ 下的目录
 * 路径解析统一走 resolveSrcPath，目录越界直接抛错；文件名带时间戳与随机后缀，不会覆盖已有文件
 * @param dir 相对 core/ 的目录，如 data/voices
 * @param buf 文件内容
 * @param prefix 文件名前缀，如 voice / wechat
 * @param ext 扩展名（不带点），如 mp3 / img
 * @returns 落地后的绝对路径
 */
export async function saveMediaFile(dir: string, buf: Buffer, prefix: string, ext: string): Promise<string> {
    const resolved = resolveSrcPath(dir);
    if (resolved.error || !resolved.fullPath) {
        throw new Error(`媒体目录路径非法: ${resolved.error ?? dir}`);
    }
    await mkdir(resolved.fullPath, { recursive: true });
    const fileName = `${prefix}-${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
    const fullPath = join(resolved.fullPath, fileName);
    await writeFile(fullPath, buf);
    return fullPath;
}
