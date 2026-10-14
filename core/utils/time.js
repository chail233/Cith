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
