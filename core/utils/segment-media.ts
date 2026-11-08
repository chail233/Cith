import { basename, resolve } from "node:path";
import { existsSync } from "node:fs";
import logger from "./logger.js";
import { baseDir } from "./file-security.js";

/** 从媒体引用推断展示用文件名：优先 localPath，其次 URL 路径末段 */
export function mediaBasename(media: { uri?: string; localPath?: string } | undefined | null): string {
    if (media?.localPath) return basename(media.localPath);
    try {
        const name = decodeURIComponent(new URL(media?.uri ?? "").pathname.split("/").pop() ?? "");
        return name || "file";
    }
    catch {
        return "file";
    }
}

/**
 * 发送侧本地路径解析
 * 模型填的相对路径（file 工具语境，以运行时根目录为基准：dev 为 core/，dist 运行为 dist/）
 * 与绝对路径统一转为绝对路径，不设目录门禁；
 * 文件不存在的路径拒绝（返回 null，调用方跳过发送）——
 * 模型填错路径是概率性事件，靠发送前校验兜底，坏路径不会产生残缺消息
 */
export function resolveSendablePath(localPath: string): string | null {
    const fullPath = resolve(baseDir, localPath);
    if (!existsSync(fullPath)) {
        logger.warn(`发送媒体文件不存在，已跳过: ${fullPath}`);
        return null;
    }
    return fullPath;
}

