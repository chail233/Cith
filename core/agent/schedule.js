import config from "../config.js";
import { createTask, listTasks, removeTask } from "../services/scheduler.js";

/**
 * 定时苏醒工具：让我（AI）自己给自己定苏醒时间。
 * 这里只做「参数校验 + 调调度器」，真正的唤醒执行在 services/wake.js，
 * 避免 tools.js -> wake -> agent-runner 的循环依赖。
 */

const scheduleSchema = {
    type: "object",
    description: "时间规则",
    properties: {
        kind: {
            type: "string",
            enum: ["once", "every", "daily", "cron"],
            description: "once=一次性；every=每隔N分钟；daily=每天固定时刻；cron=标准5段表达式",
        },
        at: {
            type: "string",
            description: "kind=once 时必填，本地时间 'YYYY-MM-DD HH:mm' 或 'YYYY-MM-DD'",
        },
        everyMinutes: {
            type: "integer",
            description: "kind=every 时必填，间隔分钟数，最小 1",
        },
        times: {
            type: "array",
            items: { type: "string" },
            description: "kind=daily 时填 ['08:30','22:00'] 这样的时刻列表",
        },
        expr: {
            type: "string",
            description: "kind=cron 时填，如 '*/30 * * * *'、'0 9 * * 1-5'",
        },
    },
    required: ["kind"],
};

const spaceSchema = {
    type: "object",
    description: "要苏醒在哪个会话，不填则默认当前会话",
    properties: {
        from: { type: "string", enum: ["group", "user"] },
        id: { type: "string", description: "群号或用户号" },
    },
};

export const scheduleTools = [
    {
        type: "function",
        function: {
            name: "schedule",
            description:
                "管理我自己的定时闹钟（到点被叫醒，说不说由我自己判断）。" +
                "action=create 新建、list 查看全部、delete 删除。",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["create", "list", "delete"],
                        description: "create=新建；list=查看全部；delete=删除",
                    },
                    id: { type: "string", description: "action=delete 时必填，任务 id" },
                    title: { type: "string", description: "action=create 时填，简短标题" },
                    prompt: {
                        type: "string",
                        description: "action=create 时填，给自己的备忘：醒来要做什么/说什么",
                    },
                    schedule: scheduleSchema,
                    space: spaceSchema,
                },
                required: ["action"],
            },
        },
    },
];

function pickSpace(param, ctx) {
    const raw = param?.space;
    if (raw && raw.from && raw.id) {
        return { from: raw.from === "user" ? "user" : "group", id: String(raw.id) };
    }
    return ctx?.space ?? null;
}

async function scheduleCreate(param, ctx) {
    const space = pickSpace(param, ctx);
    if (!space)
        return "无法确定会话，任务未创建";
    const result = await createTask({
        title: param?.title,
        prompt: param?.prompt,
        schedule: param?.schedule,
        space,
        enabled: param?.enabled,
    });
    if (!result.ok)
        return `创建失败：${result.error}`;
    const t = result.task;
    return `定时苏醒已设好\n- id：${t.id}\n- 标题：${t.title}\n- 时间：${t.schedule}\n- 下次：${t.nextRun}\n- 会话：${t.space}`;
}

async function scheduleList() {
    const items = listTasks();
    if (items.length === 0)
        return "现在没有任何定时苏醒任务";
    const lines = items.map((t) => {
        const state = t.enabled ? (t.running ? "执行中" : "启用") : "已关闭";
        return `- ${t.id}｜${t.title}｜${t.schedule}｜下次 ${t.nextRun}｜上次 ${t.lastRun}｜${state}｜${t.space}`;
    });
    return `共 ${items.length} 个：\n${lines.join("\n")}`;
}

async function scheduleDelete(param) {
    const id = String(param?.id ?? "").trim();
    if (!id)
        return "缺少任务 id";
    const result = await removeTask(id);
    if (!result.ok)
        return `删除失败：${result.error}`;
    return `已删除任务 ${result.task.id}（${result.task.title}）`;
}

/** 单入口分发：action 决定走哪个分支 */
async function scheduleTool(param, ctx) {
    const action = String(param?.action ?? "").trim().toLowerCase();
    if (action === "create")
        return scheduleCreate(param, ctx);
    if (action === "list")
        return scheduleList();
    if (action === "delete")
        return scheduleDelete(param);
    return `未知的 action：${action || "（空）"}，只支持 create/list/delete`;
}

export const scheduleToolHandlers = new Map([["schedule", scheduleTool]]);

export const SCHEDULE_TOOL_NAMES = new Set(scheduleToolHandlers.keys());

/** 只有管理员（owner）能动定时任务，其余人给出拒绝说明 */
export function isScheduleAllowed(ctx) {
    return ctx?.isAdmin === true || !config.owner || ctx?.userId === config.owner;
}