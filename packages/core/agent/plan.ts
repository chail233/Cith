export type PlanStatus = "pending" | "in_progress" | "done" | "cancelled";

export interface PlanItem {
    content: string;
    status: PlanStatus;
}

export interface Plan {
    goal: string;
    items: PlanItem[];
}

/** 模型提交的待办项（未经归一化，content/status 均不可信） */
export type RawTodo = { content?: unknown; status?: unknown } | null | undefined;

const STATUS_ICONS: Record<PlanStatus, string> = {
    pending: "○",
    in_progress: "→",
    done: "✓",
    cancelled: "✗",
};

const STATUS_KEYS: Record<PlanStatus, true> = { pending: true, in_progress: true, done: true, cancelled: true };


export function renderPlan(plan: Plan): string {
    const steps = plan.items.map((t) => `${STATUS_ICONS[t.status]} ${t.content}`).join("\n");
    return plan.goal ? `目标：${plan.goal}\n${steps}` : steps;
}


export function renderPlanBlock(plan: Plan): string {
    return `当前任务计划：\n${renderPlan(plan)}\n（勿偏离目标，随进度用 manage_plan 更新状态）`;
}


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
