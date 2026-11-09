import type { Plan, PlanStatus, RawTodo } from "./types.ts";

/** 合法状态 → 渲染图标 */
const STATUS_ICONS: Record<PlanStatus, string> = {
    pending: "○",
    in_progress: "→",
    done: "✓",
    cancelled: "✗",
};

const STATUS_KEYS: Record<PlanStatus, true> = { pending: true, in_progress: true, done: true, cancelled: true };

/** 渲染计划为文本（目标行 + 步骤清单）；无目标时仅渲染步骤 */
export function renderPlan(plan: Plan): string {
    const steps = plan.items.map((t) => `${STATUS_ICONS[t.status]} ${t.content}`).join("\n");
    return plan.goal ? `目标：${plan.goal}\n${steps}` : steps;
}

/** 单个会话的任务计划：同一时间至多一份，每次全量覆盖 */
export class PlanBoard {
    private plan: Plan | null = null;

    set(goal: unknown, todos: RawTodo[] | null | undefined): void {
        if (!Array.isArray(todos) || todos.length === 0) {
            this.plan = null;
            return;
        }
        this.plan = { goal: normalizeGoal(goal), items: todos.map(normalizeTodo) };
    }

    getActive(): Plan | null {
        if (!this.plan) return null;
        const finished = this.plan.items.every((t) => t.status === "done" || t.status === "cancelled");
        return finished ? null : this.plan;
    }

    render(): string | null {
        return this.plan ? renderPlan(this.plan) : null;
    }
}

function isPlanStatus(value: unknown): value is PlanStatus {
    return typeof value === "string" && value in STATUS_KEYS;
}

function normalizeTodo(raw: RawTodo): Plan["items"][number] {
    return {
        content: String(raw?.content ?? "").slice(0, 200),
        status: isPlanStatus(raw?.status) ? raw.status : "pending",
    };
}

function normalizeGoal(raw: unknown): string {
    return String(raw ?? "").slice(0, 200);
}
