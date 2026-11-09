import type { ToolApprovalData } from "../types/segment.ts";

/**
 * 从消息段 data 中取出询问信息（段由代码构造，字段仍做兜底归一化）
 */
export function toApprovalData(data: Record<string, unknown>): ToolApprovalData {
    const str = (value: unknown): string => (typeof value === "string" ? value : "");
    return {
        id: str(data.id),
        toolName: str(data.toolName),
        requestedBy: str(data.requestedBy),
        requestedByName: str(data.requestedByName),
        reason: str(data.reason),
        summary: str(data.summary),
    };
}

/**
 * 把询问信息渲染为纯文本（OneBot 与微信共用；微信侧不支持 @ 段，靠昵称对上号）
 */
export function renderApprovalNotice(data: ToolApprovalData): string {
    const lines = [`【待确认】${data.toolName || "工具"} 操作 #${data.id}`];
    const who = data.requestedByName || data.requestedBy;
    if (who) lines.push(`发起人：${who}`);
    if (data.reason) lines.push(`原因：${data.reason}`);
    if (data.summary) lines.push(`内容：${data.summary}`);
    lines.push(`管理员可回复 #do-yes ${data.id} 执行，#do-no ${data.id} 取消`);
    return lines.join("\n");
}
