import { useId, useState, type ReactNode } from 'react'
import type { TraceData, TraceStatus } from '../types'
import { ChevronIcon } from './icons'
import './ToolTrace.css'

const STATUS_LABEL: Record<TraceStatus, string> = {
    running: '执行中',
    ok: '已返回',
    error: '执行失败',
    timeout: '等待超时',
    aborted: '已中断',
    unknown: '未收到结果',
}

export function ToolTraceGroup({ running, children }: { running: boolean; children: ReactNode }) {
    const [open, setOpen] = useState(false)
    const rowsId = useId()
    return (
        <div className={`trace-group${running ? ' running' : ''}`}>
            <button
                className="trace-bar"
                aria-label={running ? '调用了工具，执行中' : undefined}
                aria-expanded={open}
                aria-controls={rowsId}
                onClick={() => setOpen(!open)}
            >
                <ChevronIcon open={open} />
                <span className="trace-group-label">调用了工具</span>
            </button>
            <div className="trace-group-rows" id={rowsId} hidden={!open}>
                {open && children}
            </div>
        </div>
    )
}

export function ToolTrace({ data }: { data: TraceData }) {
    const [open, setOpen] = useState(false)
    const hasDetails = Boolean(data.command || data.output)
    const duration = data.durationMs != null ? ` · ${(data.durationMs / 1000).toFixed(1)}s` : ''

    return (
        <div className={`trace ${data.status}${open ? ' open' : ''}`}>
            <button className="trace-bar" disabled={!hasDetails} aria-expanded={open} onClick={() => setOpen(!open)}>
                <ChevronIcon open={open} />
                <span className="trace-name" title={data.name}>{data.name}</span>
                {data.summary && <span className="trace-summary">{data.summary}</span>}
                <span className="trace-status" role="status">
                    <i className={`trace-dot ${data.status}`} />
                    {STATUS_LABEL[data.status]}{duration}
                </span>
            </button>
            <div className="trace-body" aria-hidden={!open}>
                <div className="trace-pad">
                    {data.command && (
                        <div className="trace-cmd">
                            <span className="trace-prompt">$</span>
                            {data.command}
                        </div>
                    )}
                    {data.output && <pre className="trace-out" tabIndex={open ? 0 : -1}>{data.output}</pre>}
                </div>
            </div>
        </div>
    )
}
