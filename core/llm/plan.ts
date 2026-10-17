/**
 * 会话级任务计划（Plan）
 * 供 manage_plan 工具读写，并在每轮请求中回注上下文，帮助模型在多步任务中不丢目标
 * 计划是易失的工作态（非资产），仅存内存、随会话回收清理，不落盘
 */

/** 步骤状态 */
export type PlanStatus = "pending" | "in_progress" | "done" | "cancelled";

/** 计划条目 */
export interface PlanItem {
    content: string;
    status: PlanStatus;
}

/** 工具入参的原始条目：来自模型生成的 JSON，字段类型不可信，需经归一化 */
export type RawTodo = { content?: unknown; status?: unknown } | null | undefined;

/** 合法状态 → 渲染图标 */
const STATUS_ICONS: Record<PlanStatus, string> = {
    pending: "○",
    in_progress: "→",
    done: "✓",
    cancelled: "✗",
};

const plans = new Map<string, PlanItem[]>();

/** 判断任意值是否为合法状态（类型守卫，替代断言） */
function isPlanStatus(value: unknown): value is PlanStatus {
    return typeof value === "string" && value in STATUS_ICONS;
}

/** 归一化单条原始输入：状态非法回落 pending，内容截断防止上下文膨胀 */
function normalizeTodo(raw: RawTodo): PlanItem {
    return {
        content: String(raw?.content ?? "").slice(0, 200),
        status: isPlanStatus(raw?.status) ? raw.status : "pending",
    };
}

/**
 * 覆盖写入某会话的计划（全量替换）；空数组或非法输入视为清空
 */
export function setPlan(sessionId: string, todos: RawTodo[] | null | undefined): void {
    if (!Array.isArray(todos) || todos.length === 0) {
        plans.delete(sessionId);
        return;
    }
    plans.set(sessionId, todos.map(normalizeTodo));
}

/** 获取某会话的计划，不存在时返回 null */
export function getPlan(sessionId: string): PlanItem[] | null {
    return plans.get(sessionId) ?? null;
}

/**
 * 获取未完成（存在 pending/in_progress 条目）的计划，用于决定是否回注上下文
 * 全部完成后不再注入，避免残留过期目标
 */
export function getActivePlan(sessionId: string): PlanItem[] | null {
    const plan = plans.get(sessionId);
    if (!plan) return null;
    const finished = plan.every((t) => t.status === "done" || t.status === "cancelled");
    return finished ? null : plan;
}

/** 删除某会话的计划（会话回收时调用） */
export function deletePlan(sessionId: string): void {
    plans.delete(sessionId);
}

/** 渲染计划为文本 */
export function renderPlan(todos: PlanItem[]): string {
    return todos.map((t) => `${STATUS_ICONS[t.status]} ${t.content}`).join("\n");
}
