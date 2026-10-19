// @ts-check

/**
 * 生成 [min, max] 之间的随机整数
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export default function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}