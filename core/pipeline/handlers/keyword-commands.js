import getSentence from "../../services/hitokoto.js";
import getAcg from "../../services/acg.js";
import getSunGirl from "../../data/assets.js";
import { getAgent } from "../../agent/AgentManager.ts";
import { nowTime } from "../../utils/time.js";

/**
 * 关键词命令处理器
 * 精确匹配文本触发对应功能
 */

const CMD_MAP = new Map();

CMD_MAP.set("来句台词", async (ctx) => {
    const sentence = await getSentence();
    const time = nowTime();
    const recorder = getAgent(ctx.space).memory;
    if (sentence) {
        ctx.adapter.sendMsg(ctx.space, sentence);
        recorder.add({ role: "assistant", content: { text: sentence, time } });
    } else {
        ctx.adapter.sendMsg(ctx.space, "别急");
        recorder.add({ role: "assistant", content: { text: "别急", time } });
    }
});

CMD_MAP.set("来张图", async (ctx) => {
    const img = await getAcg();
    if (img) {
        ctx.adapter.sendMsg(ctx.space, img);
    }
});

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