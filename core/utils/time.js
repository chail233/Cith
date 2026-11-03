/**
 * 将 Unix 时间戳（秒）格式化为可读时间字符串
 * @param {number} timestamp Unix 时间戳（秒）
 * @returns {string} 格式如 "2026-10-03 14:30:00"
 */
export function formatTime(timestamp) {
    const d = new Date(timestamp * 1000);
    const pad = (n) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 获取当前时间的格式化字符串
 * @returns {string} 格式如 "2026-10-03 14:30:00"
 */
export function nowTime() {
    return formatTime(Math.floor(Date.now() / 1000));
}

/** 一天的毫秒数 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 超过多少天改用「年」表达 */
const YEAR_DAYS = 365;

/**
 * 把记忆的入库时间格式化成「绝对日期 + 距今」
 *
 *
 * @param {number} createdAt 记忆创建时间（毫秒时间戳，即 rememori 的 createdAt）
 * @param {number} [now] 参考时间（毫秒），默认当前时间，便于测试注入
 * @returns {string} 格式如 "2026-09-12，52天前"；时间非法时返回空串
 */
export function formatMemoryTime(createdAt, now = Date.now()) {
    const ms = Number(createdAt);
    if (!Number.isFinite(ms) || ms <= 0) return "";
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";

    const pad = (n) => n.toString().padStart(2, "0");
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    // 时钟回拨会让差值变负，当作「今天」处理，不显示负数天
    const days = Math.floor((now - ms) / DAY_MS);
    if (days <= 0) return `${date}，今天`;
    if (days === 1) return `${date}，昨天`;
    if (days < YEAR_DAYS) return `${date}，${days}天前`;
    return `${date}，${Math.floor(days / YEAR_DAYS)}年前`;
}
