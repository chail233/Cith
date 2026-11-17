export type CoreState = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed'


export type CoreStatus = {
    state: CoreState
    pid?: number
    exitCode?: number | null
    startedAt?: number
    message?: string
}

/** 一行启动日志（主进程 → 渲染层广播） */
export type CoreLogLine = { ts: number; text: string }

/** core 用户配置层的宽松形状：键集由 core 的 config.js 定义，这里不做严格校验 */
export type CoreConfig = Record<string, unknown>
