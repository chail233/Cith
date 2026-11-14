/**
 * logs action：从环形缓冲按时间戳补拉历史事件/日志
 */
import { eventLog } from "../event-log.ts";
import { registerAction } from "../router.ts";

registerAction("get_logs", (params) => {
    const since = (params?.since as number) ?? 0;
    const limit = (params?.limit as number) ?? 200;

    // 只返回 since 之后的事件，并截取最近 limit 条，避免一次性推送过量
    const events = eventLog.toArray().filter((e) => e.ts > since);
    return events.slice(-limit);
});
