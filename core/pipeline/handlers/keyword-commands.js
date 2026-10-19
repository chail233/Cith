import getSunGirl from "../../data/assets.js";

/**
 * 关键词命令处理器
 * 精确匹配文本触发对应功能
 */

const CMD_MAP = new Map();

CMD_MAP.set("来只孙巴二娘", async (ctx) => {
    ctx.adapter.sendMsg(ctx.space, [
        { type: "image", data: { file: getSunGirl() } },
    ]);
});

CMD_MAP.set("来只牛魔", async (ctx) => {
    ctx.adapter.sendMsg(ctx.space, [
        {
            type: "image",
            data: {
                file: "https://img.tofaka.com/autoupload/f/8d522/20260817/myLT/2048X2048/0.png",
            },
        },
    ]);
});

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