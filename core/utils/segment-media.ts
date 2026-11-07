import { basename } from "node:path";

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
