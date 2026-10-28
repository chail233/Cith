// @ts-check

import config from "../../config.js";
import { resolveName } from "../context.ts";

/**
 * at 检测中间件
 * 解析消息中的 at 段，将被 at 对象的名字写入 ctx.at；
 * 若 at 的是机器人，则 ctx.at = "我"
 * @param {import("../../types/index.ts").Context} ctx
 */
export default function atDetector(ctx) {
    const segments = /** @type {Array<{type: string, data?: {qq?: string|number, name?: string}}>} */ (ctx.seg || []);
    for (const seg of segments) {
        if (seg.type !== "at") continue;
        const qq = seg.data?.qq == null ? "" : String(seg.data.qq);
        if (qq === config.selfId) {
            ctx.at = "我";
            break;
        }
        if (!ctx.at) {
            ctx.at = resolveName(qq, seg.data?.name);
        }
    }
}