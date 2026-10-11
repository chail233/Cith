/**
 * 提取消息中的纯文本
 */
export function extractText(segments: { type: string; data: { text?: string } }[]): string {
    return segments
        .filter((x) => x.type === "text")
        .map((x) => x.data.text ?? "")
        .join("");
}