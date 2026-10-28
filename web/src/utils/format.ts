/** 展示格式化工具 */

/** 毫秒 → "x天x小时x分x秒" */
export function formatUptime(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return "-";
    const totalSec = Math.floor(ms / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (d > 0) return `${d}天 ${h}小时 ${m}分`;
    if (h > 0) return `${h}小时 ${m}分 ${s}秒`;
    if (m > 0) return `${m}分 ${s}秒`;
    return `${s}秒`;
}

/** 毫秒时间戳 → "HH:mm:ss" */
export function formatTime(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number, len = 2) => String(n).padStart(len, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 毫秒时间戳 → "YYYY-MM-DD HH:mm:ss" */
export function formatDateTime(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number, len = 2) => String(n).padStart(len, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${formatTime(ts)}`;
}

/** 任意值 → 紧凑展示文本；超长截断 */
export function formatValue(value: unknown, maxLen = 120): string {
    let text: string;
    if (typeof value === "string") {
        text = value;
    } else if (value === undefined) {
        text = "undefined";
    } else {
        try {
            text = JSON.stringify(value) ?? "null";
        } catch {
            text = String(value);
        }
    }
    return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}
