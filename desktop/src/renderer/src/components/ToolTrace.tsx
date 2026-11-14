import { useState } from 'react'
import type { ToolTrace as ToolTraceData } from '../types'
import { ChevronIcon } from './icons'
import './ToolTrace.css'

export function ToolTrace({ trace }: { trace: ToolTraceData }) {
    const [open, setOpen] = useState(false)
    const statusText = trace.status === 'ok' ? '完成' : trace.status === 'error' ? '出错' : '运行中'
    const duration = trace.durationMs != null ? ` · ${(trace.durationMs / 1000).toFixed(1)}s` : ''

    return (
        <div className={`trace ${trace.status}${open ? ' open' : ''}`}>
            <button className="trace-bar" onClick={() => setOpen(!open)}>
                <ChevronIcon open={open} />
                <span className="trace-name">{trace.name}</span>
                <span className="trace-summary">{trace.summary}</span>
                <span className="trace-status">
                    <i className={`trace-dot ${trace.status}`} />
                    {statusText}{duration}
                </span>
            </button>
            <div className="trace-body">
                <div className="trace-pad">
                    {trace.command && (
                        <div className="trace-cmd">
                            <span className="trace-prompt">$</span>
                            {trace.command}
                        </div>
                    )}
                    {trace.output && <pre className="trace-out">{trace.output}</pre>}
                </div>
            </div>
        </div>
    )
}
