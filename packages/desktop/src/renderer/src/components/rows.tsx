import { useEffect, useState, type ReactNode } from 'react'

/** 设置与本地核心界面共用的行组件，样式在 Settings.css（全局类） */

export function SliderRow({ label, value, min, max, step, format, onChange }: {
    label: string
    value: number
    min: number
    max: number
    step: number
    format: (v: number) => string
    onChange: (v: number) => void
}) {
    const pct = ((value - min) / (max - min)) * 100
    return (
        <div className="slider-row">
            <div className="slider-head">
                <span className="slider-label">{label}</span>
                <span className="slider-value">{format(value)}</span>
            </div>
            <input
                type="range"
                className="range"
                min={min}
                max={max}
                step={step}
                value={value}
                style={{ background: `linear-gradient(to right, var(--accent) ${pct}%, var(--bg-3) ${pct}%)` }}
                onChange={(e) => onChange(Number(e.target.value))}
            />
        </div>
    )
}

/** 开关行：与滑块行同一套留白节奏，右侧是自绘开关 */
export function SwitchRow({ label, hint, checked, onChange }: {
    label: string
    hint?: string
    checked: boolean
    onChange: (v: boolean) => void
}) {
    return (
        <div className="switch-row">
            <div className="switch-text">
                <span className="field-label">{label}</span>
                {hint && <span className="field-hint">{hint}</span>}
            </div>
            <button
                role="switch"
                aria-checked={checked}
                aria-label={label}
                className={`switch${checked ? ' on' : ''}`}
                onClick={() => onChange(!checked)}
            >
                <span className="switch-knob" />
            </button>
        </div>
    )
}

/** 二选一行：分段控件，选中项用表面色阶而不是面色 */
export function OptionRow<T extends string>({ label, hint, value, options, onChange }: {
    label: string
    hint?: string
    value: T
    options: Array<{ value: T; label: string }>
    onChange: (v: T) => void
}) {
    return (
        <div className="switch-row">
            <div className="switch-text">
                <span className="field-label">{label}</span>
                {hint && <span className="field-hint">{hint}</span>}
            </div>
            <div className="seg">
                {options.map((option) => (
                    <button
                        key={option.value}
                        className={`seg-item${option.value === value ? ' on' : ''}`}
                        onClick={() => onChange(option.value)}
                    >
                        {option.label}
                    </button>
                ))}
            </div>
        </div>
    )
}

/** 动作行：危险动作走二次确认（四秒内再点一次才执行），执行结果在按钮上反馈一会儿 */
export function ActionRow({ label, hint, actionLabel, doneLabel = '已完成', danger, onAction }: {
    label: string
    hint?: string
    actionLabel: string
    /** 成功后的提示文案，默认「已完成」 */
    doneLabel?: string
    danger?: boolean
    onAction: () => void | Promise<void>
}) {
    const [armed, setArmed] = useState(false)
    const [result, setResult] = useState<'done' | 'failed' | null>(null)
    const [failure, setFailure] = useState('')

    // 二次确认只留一会儿，避免长时间挂着“再点一次”
    useEffect(() => {
        if (!armed) return
        const timer = window.setTimeout(() => setArmed(false), 4000)
        return () => window.clearTimeout(timer)
    }, [armed])

    // 结果提示同样只留一会儿：失败时把原因直接摆出来，不用去开控制台
    useEffect(() => {
        if (!result) return
        const timer = window.setTimeout(() => {
            setResult(null)
            setFailure('')
        }, 5000)
        return () => window.clearTimeout(timer)
    }, [result])

    async function run(): Promise<void> {
        try {
            await onAction()
            setResult('done')
        }
        catch (err) {
            console.warn('设置动作执行失败:', err)
            setResult('failed')
            setFailure(err instanceof Error ? err.message : String(err))
        }
    }

    const text =
        armed ? '再点一次确认'
            : result === 'failed' ? '失败'
                : result === 'done' ? doneLabel
                    : actionLabel

    return (
        <div className="action-row">
            <div className="switch-text">
                <span className="field-label">{label}</span>
                {result === 'failed'
                    ? <span className="field-hint failure" title={failure}>失败：{failure.slice(0, 120)}</span>
                    : hint && <span className="field-hint">{hint}</span>}
            </div>
            <button
                className={`action-btn${danger ? ' danger' : ''}${armed ? ' armed' : ''}${result ? ` ${result}` : ''}`}
                onClick={() => {
                    if (danger && !armed) {
                        setArmed(true)
                        return
                    }
                    setArmed(false)
                    void run()
                }}
            >
                {text}
            </button>
        </div>
    )
}

export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="field-row">
            <div className="field-head">
                <span className="field-label">{label}</span>
            </div>
            {children}
        </div>
    )
}
