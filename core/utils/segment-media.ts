import { basename } from "node:path";
import { existsSync } from "node:fs";
import logger from "./logger.js";
import { resolveSrcPath } from "./file-security.js";

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
 * 模型填的相对路径（file 工具语境，钉在 core/）与表情包等绝对路径统一转为绝对路径；
 * 越出 core/ 或文件不存在的路径拒绝（返回 null，调用方跳过发送）——
 * 模型填错路径是概率性事件，靠发送前校验兜底，坏路径不会产生残缺消息
 */
export function resolveSendablePath(localPath: string): string | null {
    const resolved = resolveSrcPath(localPath);
    if (resolved.error || !resolved.fullPath) {
        logger.warn(`发送媒体路径非法，已跳过: ${localPath} (${resolved.error ?? "未知错误"})`);
        return null;
    }
    if (!existsSync(resolved.fullPath)) {
        logger.warn(`发送媒体文件不存在，已跳过: ${resolved.fullPath}`);
        return null;
    }
    return resolved.fullPath;
}

