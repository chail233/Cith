/**
 * 面板前端协议与领域类型
 */

/** Bot → 面板 事件帧（SSE data 字段即此结构） */
export interface EventFrame {
    type: "event";
    /** 事件名，约定为 `域.动作`，如 log；未知事件名需兼容处理 */
    event: string;
    /** 毫秒时间戳，SSE id 即此值，重连时由 EventSource 自动以 Last-Event-ID 携带补拉 */
    ts: number;
    data: unknown;
}

/** log 事件的 data 结构 */
export interface LogEventData {
    level: string;
    ts: number;
    msg: string;
}

/** 启动配置自检项（get_status.configWarnings） */
export interface ConfigWarning {
    /** error = 不修复就无法正常回复；warn = 功能降级 */
    level: "error" | "warn";
    /** 对应配置项键名 */
    key: string;
    /** 问题描述 */
    message: string;
    /** 修复方式 */
    fix: string;
}

/** get_status 返回的运行状态快照 */
export interface BotStatus {
    uptimeMs: number;
    onebotConnected: boolean;
    mcpConnections: number;
    memoryMb: number;
    nodeVersion: string;
    /** 启动自检结果；旧版本 Bot 不返回此字段 */
    configWarnings?: ConfigWarning[];
}

/** get_config 返回的脱敏配置快照（键 → 标量/标量数组/"***"） */
export type ConfigSnapshot = Record<string, unknown>;

/** /api/health 返回 */
export interface HealthInfo {
    bff: boolean;
    bot: { connected: boolean; authenticated: boolean };
    lastEventTs: number;
}

/** /api/session 返回 */
export interface SessionInfo {
    /** BFF 是否启用了密码登录 */
    required: boolean;
    /** 当前浏览器是否已登录 */
    authed: boolean;
}

/** list_actions 返回 */
export interface ActionsInfo {
    actions: string[];
}

/** 日志级别（log 事件） */
export const LOG_LEVELS = ["INFO", "WARN", "ERROR", "DEBUG"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * 本地维护的 action 说明，仅用于面板展示；
 * Bot 端新增 action 时此处缺省，展示为"未知能力"。
 */
export const ACTION_DESCRIPTIONS: Record<string, string> = {
    get_status: "运行状态快照：运行时长、OneBot 在线状态、MCP 连接数、内存占用、Node 版本、启动配置自检告警",
    get_config: "读取脱敏后的配置快照（敏感字段以 *** 展示）",
    set_config: "热改白名单内的配置字段，白名单外的字段会被 Bot 拒绝",
    get_logs: "按时间戳从环形缓冲补拉历史事件（默认容量 1000 条）",
    list_actions: "获取 Bot 当前支持的 action 清单",
};
