/**
 * pricing action：模型价格表读取与整体替换
 *
 */
import { getPricingSnapshot, setPricingModels } from "../../services/model-pricing.ts";
import { listUsageModels } from "../../services/token-usage.ts";
import { registerAction } from "../router.ts";

registerAction("get_model_pricing", async () => {
    const snapshot = await getPricingSnapshot();
    return { ...snapshot, seenModels: await listUsageModels() };
});

registerAction("set_model_pricing", async (params) => {
    const snapshot = await setPricingModels(params?.models);
    return { ...snapshot, seenModels: await listUsageModels() };
});
