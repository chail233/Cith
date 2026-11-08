import type { MessageSegment } from "../types/index.ts";

/**
 * 提取消息中的纯文本
 */
export function extractText(segments: { type: string; data: { text?: string } }[]): string {
    return segments
        .filter((x) => x.type === "text")
        .map((x) => x.data.text ?? "")
        .join("");
}


export function compactSegments(
    segments: MessageSegment[],
): MessageSegment[] {
    const out: MessageSegment[] = [];
    for (const seg of segments ?? []) {
        const d = (seg?.data ?? {}) as Record<string, any>;
        switch (seg?.type) {
            case "text":
                if (d.text) out.push({ type: "text", data: { text: d.text } });
                break;

            case "image": {
                const media = d.media as { uri?: string; localPath?: string } | undefined;
                if (!media?.uri && !media?.localPath && !d.alt) break;
                const data: Record<string, unknown> = {};
                const kept: Record<string, string> = {};
                if (media?.uri) kept.uri = media.uri;
                if (media?.localPath) kept.localPath = media.localPath;
                if (kept.uri || kept.localPath) data.media = kept;
                if (d.alt) data.alt = d.alt;
                out.push({ type: "image", data });
                break;
            }

            case "file": {
                const media = d.media as { uri?: string } | undefined;
                if (!media?.uri && !d.name) break;
                const data: Record<string, unknown> = {};
                if (media?.uri) data.media = { uri: media.uri };
                if (d.name) data.name = d.name;
                out.push({ type: "file", data });
                break;
            }

            case "mention": {
                if (!d.name && !d.isSelf) break;
                const data: Record<string, unknown> = {};
                if (d.name) data.name = d.name;
                if (d.isSelf) data.isSelf = true;
                out.push({ type: "mention", data });
                break;
            }

            case "reply": {
                if (!d.id) break;
                const data: Record<string, unknown> = { id: d.id };
                if (d.excerpt) data.excerpt = d.excerpt;
                out.push({ type: "reply", data });
                break;
            }

            case "link_card": {
                if (!d.title && !d.url) break;
                const data: Record<string, unknown> = {};
                if (d.title) data.title = d.title;
                if (d.url) data.url = d.url;
                if (d.description) data.description = d.description;
                out.push({ type: "link_card", data });
                break;
            }

            default:
                out.push(seg);
        }
    }

    return out;
}
