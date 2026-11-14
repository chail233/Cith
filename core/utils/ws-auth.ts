/**
 * WS 握手鉴权：反向 WS / 自开 WS 共用的接入校验
 * 各 Server 自持鉴权开关（未配置 token 时不校验，由启动自检提示风险）
 */
import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";

/** 握手请求携带的 token：优先 Authorization: Bearer，其次 ?access_token= 查询参数 */
export function extractToken(req: IncomingMessage): string {
    const header = req.headers.authorization ?? "";
    if (header.startsWith("Bearer ")) return header.slice(7).trim();
    try {
        return new URL(req.url ?? "/", "http://localhost").searchParams.get("access_token")?.trim() ?? "";
    }
    catch {
        return "";
    }
}

/** 常数时间比较两个 token：先哈希对齐长度，避免逐字节比较泄漏信息 */
export function tokenMatches(candidate: string, expected: string): boolean {
    const given = crypto.createHash("sha256").update(candidate).digest();
    const expect = crypto.createHash("sha256").update(expected).digest();
    return crypto.timingSafeEqual(given, expect);
}
