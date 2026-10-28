
/**
 * 关键词命令处理器
 * 精确匹配文本触发对应功能
 */

const CMD_MAP = new Map();

/**
 * @param {object} ctx 管道上下文
 * @returns {Promise<boolean>} 是否已处理
 */
export default async function keywordCommands(ctx) {
    const handler = CMD_MAP.get(ctx.text);
    if (!handler) return false;

    await handler(ctx);
    return true;
}