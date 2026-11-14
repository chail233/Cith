/**
 * usage action：模型 Token 用量统计查询（今日 / 近 N 天 / 累计）
 */
import { getUsageSummary } from "../../services/token-usage.ts";
import { registerAction } from "../router.ts";

registerAction("get_token_usage", (params) => {
    const days = Math.min(Math.max(Number(params?.days) || 7, 1), 90);
    return getUsageSummary(days);
});
