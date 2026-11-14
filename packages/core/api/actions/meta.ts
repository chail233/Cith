/**
 * meta action：暴露面板可用的 action 能力清单
 */
import { listActions, registerAction } from "../router.ts";

registerAction("list_actions", () => {
    return { actions: listActions() };
});
