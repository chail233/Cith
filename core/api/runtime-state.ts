/**
 * Bot 运行时共享状态：供 API 层读取的轻量状态快照
 */

/** 启动配置自检项：面板据此常驻展示告警 */
export interface ConfigWarning {
    /** error = 不修复就无法正常回复；warn = 功能降级 */
    level: "error" | "warn";
    /** 对应配置项键名，便于用户定位 */
    key: string;
    /** 问题描述 */
    message: string;
    /** 修复方式 */
    fix: string;
}

export const runtimeState: {
    startedAt: number;
    onebotConnected: boolean;
    /** 启动自检结果，启动后不再变化 */
    configWarnings: ConfigWarning[];
} = {
    startedAt: Date.now(),
    onebotConnected: false,
    configWarnings: [],
};
