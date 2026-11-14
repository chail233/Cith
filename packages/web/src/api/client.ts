/**
 * BFF HTTP 客户端封装
 */
import type { HealthInfo, SessionInfo } from "../types";

/** 会话 token 存储键 */
const TOKEN_KEY = "cith_panel_token";

export class ApiError extends Error {
    readonly httpStatus: number;
    constructor(message: string, httpStatus = 0) {
        super(message);
        this.httpStatus = httpStatus;
    }
}

/** 会话失效（401），需要重新登录 */
export class AuthError extends ApiError {
    constructor(message = "登录已失效，请重新登录") {
        super(message, 401);
    }
}

export function getStoredToken(): string {
    return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setStoredToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
    localStorage.removeItem(TOKEN_KEY);
}

/** 带会话凭证的 fetch；401 时统一抛 AuthError */
async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
    const token = getStoredToken();
    const headers = new Headers(init?.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    let res: Response;
    try {
        res = await fetch(url, { ...init, headers });
    } catch {
        throw new ApiError("无法连接面板服务（BFF），请确认 BFF 进程已启动");
    }
    if (res.status === 401) throw new AuthError();
    return res;
}

/** RPC 响应体：与 BFF 约定，业务错误以 200 + status:"error" 返回 */
interface RpcOk {
    status: "ok";
    data?: unknown;
}
interface RpcError {
    status: "error";
    message: string;
}
type RpcResponse = RpcOk | RpcError;

/** 调用一个 Bot action（经 BFF 转发），成功返回 data，失败抛 ApiError；401 时清凭证回到登录页 */
export async function rpc<T>(action: string, params?: Record<string, unknown>): Promise<T> {
    let res: Response;
    let body: RpcResponse;
    try {
        res = await authedFetch("/api/rpc", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, params }),
        });
        body = (await res.json()) as RpcResponse;
    }
    catch (err) {
        // BFF 会话存内存，重启后旧 token 必然 401：清掉本地凭证回到登录页，避免页面停留在一堆报错上
        if (err instanceof AuthError) {
            clearStoredToken();
            window.location.reload();
        }
        throw err;
    }
    if (body.status === "error") throw new ApiError(body.message, res.status);
    return body.data as T;
}

/** 查询 BFF 会话要求与登录状态（携带本地已存 token 以便免登录恢复会话） */
export async function fetchSession(): Promise<SessionInfo> {
    const res = await authedFetch("/api/session");
    if (!res.ok) throw new ApiError(`获取会话状态失败（HTTP ${res.status}）`, res.status);
    const body = (await res.json()) as { status: string; data: SessionInfo };
    return body.data;
}

/** 密码登录，成功后 token 存入 localStorage */
export async function login(password: string): Promise<void> {
    let res: Response;
    try {
        res = await fetch("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
        });
    }
    catch {
        throw new ApiError("无法连接面板服务（BFF）");
    }
    const body = (await res.json()) as { status: string; message?: string; data?: { token?: string } };
    if (body.status !== "ok" || !body.data?.token) {
        throw new ApiError(body.message ?? "登录失败", res.status);
    }
    setStoredToken(body.data.token);
}

/** 查询 BFF/Bot 连接状态（无需凭证，供顶栏状态灯使用） */
export async function fetchHealth(): Promise<HealthInfo> {
    const res = await fetch("/api/health");
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
    const body = (await res.json()) as HealthInfo;
    return body;
}

/** 事件流地址：启用了密码登录时通过查询参数携带会话 token（EventSource 无法自定义请求头） */
export function eventStreamUrl(): string {
    const token = getStoredToken();
    return token ? `/api/events?token=${encodeURIComponent(token)}` : "/api/events";
}
