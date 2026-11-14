import { useState } from 'react'
import type { TraceData } from '../types'
import { ChevronIcon } from './icons'
import './ToolTrace.css'

export function ToolTrace({ data }: { data: TraceData }) {
    const [open, setOpen] = useState(false)
    const statusText = data.status === 'ok' ? '完成' : data.status === 'error' ? '出错' : '运行中'
    const duration = data.durationMs != null ? ` · ${(data.durationMs / 1000).toFixed(1)}s` : ''

    return (
        <div className={`trace ${data.status}${open ? ' open' : ''}`}>
            <button className="trace-bar" onClick={() => setOpen(!open)}>
                <ChevronIcon open={open} />
                <span className="trace-name">{data.name}</span>
                <span className="trace-summary">{data.summary}</span>
                <span className="trace-status">
                    <i className={`trace-dot ${data.status}`} />
                    {statusText}{duration}
                </span>
            </button>
            <div className="trace-body">
                <div className="trace-pad">
                    {data.command && (
                        <div className="trace-cmd">
                            <span className="trace-prompt">$</span>
                            {data.command}
                        </div>
                    )}
                    {data.output && <pre className="trace-out">{data.output}</pre>}
                </div>
            </div>
        </div>
    )
}
