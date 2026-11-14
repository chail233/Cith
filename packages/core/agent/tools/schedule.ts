import { createTask, listTasks, removeTask } from "../../services/scheduler.js";
import type { Space } from "../../types/index.ts";
import type { ToolContext, ToolDefinition, ToolModule } from "../types.ts";


/** schedule 工具入参 */
export interface ScheduleParams {
    action?: unknown;
    id?: unknown;
    title?: unknown;
    prompt?: unknown;
    schedule?: {
        kind?: unknown;
        at?: unknown;
        everyMinutes?: unknown;
        times?: unknown;
        expr?: unknown;
    };
    space?: { from?: unknown; id?: unknown };
}

export const definition: ToolDefinition = {
    type: "function",
    function: {
        name: "schedule",
        description:
            "管理定时苏醒：给自己设闹钟、轮询或主动发起行为，用法由你决定，不向用户显式说明。" +
            "action=create 新建 / list 查看 / delete 删除，不用的条目及时清除。",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["create", "list", "delete"] },
                id: { type: "string", description: "delete 时必填：任务 id（从 list 获取）" },
                title: { type: "string", description: "create 时填，简短标题" },
                prompt: { type: "string", description: "create 时填，给自己的备忘：醒来做什么/说什么" },
                schedule: {
                    type: "object",
                    description:
                        "create 时填。once→at（'YYYY-MM-DD HH:mm'）；every→everyMinutes（≥1）；" +
                        "daily→times（['08:30','22:00']）；cron→expr（5 段，如 '0 9 * * 1-5'）",
                    properties: {
                        kind: { type: "string", enum: ["once", "every", "daily", "cron"] },
                        at: { type: "string" },
                        everyMinutes: { type: "integer" },
                        times: { type: "array", items: { type: "string" } },
                        expr: { type: "string" },
                    },
                    required: ["kind"],
                },
                space: {
                    type: "object",
                    description: "create 可选：苏醒到哪个会话（from: group/user，id: 群号/用户号），缺省当前会话",
                    properties: {
                        from: { type: "string", enum: ["group", "user"] },
                        id: { type: "string" },
                    },
                },
            },
            required: ["action"],
        },
    },
};

/** 归一化目标会话：优先用模型指定的 space，否则回落当前会话；渠道始终继承当前会话 */
function pickSpace(param: ScheduleParams, ctx?: ToolContext): Space | null {
    const raw = param?.space;
    if (raw && raw.from && raw.id) {
        return {
            from: raw.from === "user" ? "user" : "group",
            id: String(raw.id),
            channel: ctx?.space.channel ?? "onebot",
        };
    }
    return ctx?.space ?? null;
}

async function scheduleCreate(param: ScheduleParams, ctx?: ToolContext): Promise<string> {
    const space = pickSpace(param, ctx);
    if (!space)
        return "无法确定会话，任务未创建";
    const result = await createTask({
        title: typeof param?.title === "string" ? param.title : undefined,
        prompt: typeof param?.prompt === "string" ? param.prompt : undefined,
        schedule: param?.schedule,
        space,
    });
    if (!result.ok)
        return `创建失败：${result.error}`;
    const t = result.task;
    if (!t)
        return "任务已创建，但读取任务信息失败";
    return `定时苏醒已设好\n- id：${t.id}\n- 标题：${t.title}\n- 时间：${t.schedule}\n- 下次：${t.nextRun}\n- 会话：${t.space}`;
}

async function scheduleList(): Promise<string> {
    const items = listTasks();
    if (items.length === 0)
        return "现在没有任何定时苏醒任务";
    const lines = items.map((t) => {
        const state = t.enabled ? (t.running ? "执行中" : "启用") : "已关闭";
        return `- ${t.id}｜${t.title}｜${t.schedule}｜下次 ${t.nextRun}｜上次 ${t.lastRun}｜${state}｜${t.space}`;
    });
    return `共 ${items.length} 个：\n${lines.join("\n")}`;
}

async function scheduleDelete(param: ScheduleParams): Promise<string> {
    const id = String(param?.id ?? "").trim();
    if (!id)
        return "缺少任务 id";
    const result = await removeTask(id);
    if (!result.ok)
        return `删除失败：${result.error}`;
    const t = result.task;
    if (!t)
        return "任务已删除，但读取任务信息失败";
    return `已删除任务 ${t.id}（${t.title}）`;
}

/** 单入口分发：action 决定走哪个分支 */
async function scheduleExecute(param: ScheduleParams, ctx?: ToolContext): Promise<string> {
    const action = String(param?.action ?? "").trim().toLowerCase();
    if (action === "create")
        return scheduleCreate(param, ctx);
    if (action === "list")
        return scheduleList();
    if (action === "delete")
        return scheduleDelete(param);
    return `未知的 action：${action || "（空）"}，只支持 create/list/delete`;
}

export default { definition, execute: scheduleExecute } satisfies ToolModule<ScheduleParams>;
