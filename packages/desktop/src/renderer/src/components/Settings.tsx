import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import {
    defaultSettings,
    HISTORY_LIMIT_MAX,
    HISTORY_LIMIT_MIN,
    type UiSettings,
} from '../../../shared/settings.ts'
import type { BackendStatus } from '../../../preload/api.ts'
import { BrandMark } from '@cith/ui'
import { CloseIcon } from './icons'
import './Settings.css'

const CATEGORIES = [
    { id: 'interface', label: '界面' },
    { id: 'general', label: '通用' },
    { id: 'chats', label: '会话' },
    { id: 'notifications', label: '通知' },
    { id: 'user', label: '用户' },
    { id: 'backend', label: '后端连接' },
    { id: 'about', label: '关于' },
]

type Props = {
    settings: UiSettings
    onSave: (next: UiSettings) => void
    version: string
    backendStatus: BackendStatus
    onClearLocal: () => void
    onOpenDataDir: () => Promise<void>
    onTestNotify: () => Promise<void>
    onClose: () => void
}

export function SettingsView({ settings, onSave, version, backendStatus, onClearLocal, onOpenDataDir, onTestNotify, onClose }: Props) {
    const [active, setActive] = useState('interface')
    const [draft, setDraft] = useState<UiSettings>(() => ({ ...settings }))
    const dirty = JSON.stringify(draft) !== JSON.stringify(settings)
    const cat = CATEGORIES.find((c) => c.id === active) ?? CATEGORIES[0]

    function edit(patch: Partial<UiSettings>) {
        setDraft((d) => ({ ...d, ...patch }))
    }

    function save() {
        // 保存后弹窗留着：设置随 props 更新，dirty 归零、按钮自动置灰
        onSave(draft)
    }

    return (
        <div className="settings-overlay" onClick={onClose}>
            <main className="settings" role="dialog" aria-modal="true" aria-label="设置" onClick={(e) => e.stopPropagation()}>
                <header className="settings-head">
                    <h1 className="settings-title">设置</h1>
                    <div className="settings-head-actions">
                        <button className="settings-save" disabled={!dirty} onClick={save}>
                            保存
                        </button>
                        <button className="settings-close" aria-label="关闭设置" onClick={onClose}>
                            <CloseIcon />
                        </button>
                    </div>
                </header>
                <div className="settings-body">
                    <nav className="settings-nav">
                        {CATEGORIES.map((c) => (
                            <button
                                key={c.id}
                                className={`set-cat${c.id === active ? ' active' : ''}`}
                                onClick={() => setActive(c.id)}
                            >
                                <span>{c.label}</span>
                            </button>
                        ))}
                    </nav>

                    <section className="settings-pane" key={active}>
                        {cat.id === 'interface' && <InterfacePane settings={draft} onChange={edit} />}
                        {cat.id === 'general' && <GeneralPane settings={draft} onChange={edit} />}
                        {cat.id === 'chats' && (
                            <ChatsPane
                                settings={draft}
                                onChange={edit}
                                onClearLocal={onClearLocal}
                                onOpenDataDir={onOpenDataDir}
                            />
                        )}
                        {cat.id === 'notifications' && (
                            <NotificationsPane settings={draft} onChange={edit} onTestNotify={onTestNotify} />
                        )}
                        {cat.id === 'user' && <UserPane settings={draft} onChange={edit} />}
                        {cat.id === 'backend' && (
                            <BackendPane settings={draft} onChange={edit} status={backendStatus} />
                        )}
                        {cat.id === 'about' && <AboutPane version={version} />}
                    </section>
                </div>
            </main>
        </div>
    )
}

function InterfacePane({ settings, onChange }: { settings: UiSettings; onChange: (p: Partial<UiSettings>) => void }) {
    return (
        <>
            <header className="pane-head">
                <h2 className="pane-title">界面</h2>
                <p className="pane-desc">阅读体验，保存后生效并保存在本机；预览随拖动即时变化。</p>
            </header>

            <div className="pane-card">
                <SliderRow
                    label="文字大小"
                    value={settings.fontSize}
                    min={12}
                    max={18}
                    step={1}
                    format={(v) => `${v} px`}
                    onChange={(v) => onChange({ fontSize: v })}
                />
                <SliderRow
                    label="行距"
                    value={settings.lineHeight}
                    min={1.5}
                    max={2.1}
                    step={0.05}
                    format={(v) => v.toFixed(2)}
                    onChange={(v) => onChange({ lineHeight: v })}
                />
                <SliderRow
                    label="段落间距"
                    value={settings.paraGap}
                    min={0}
                    max={20}
                    step={1}
                    format={(v) => `${v} px`}
                    onChange={(v) => onChange({ paraGap: v })}
                />
                <SliderRow
                    label="消息间距"
                    value={settings.msgGap}
                    min={16}
                    max={40}
                    step={1}
                    format={(v) => `${v} px`}
                    onChange={(v) => onChange({ msgGap: v })}
                />
                <SliderRow
                    label="内容宽度"
                    value={settings.contentWidth}
                    min={520}
                    max={1100}
                    step={10}
                    format={(v) => `${v} px`}
                    onChange={(v) => onChange({ contentWidth: v })}
                />
            </div>

            {/* 预览卡内就地覆写草稿值（CSS 变量随子树继承），全局仍用已保存的设置 */}
            <div
                className="preview-card"
                style={{
                    '--font-msg': `${settings.fontSize}px`,
                    '--leading': String(settings.lineHeight),
                    '--para-gap': `${settings.paraGap}px`,
                    '--msg-gap': `${settings.msgGap}px`,
                } as CSSProperties}
            >
                <div className="preview-label">实时预览</div>
                <div className="preview-col">
                    <div className="msg user">
                        <div className="msg-segs">
                            <p className="msg-para">帮我看看构建日志里的报错</p>
                        </div>
                    </div>
                    <div className="msg agent">
                        <div className="msg-segs">
                            <div className="msg-text">
                                <p className="msg-para">这是预览文本。拖动上面的滑块，字号、行距和段落间距会即时变化。</p>
                                <p className="msg-para">第二段用来观察段落间距——琥珀色的工具痕迹以后也会留在消息流里，陪你看着 Agent 干活。</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="pane-foot">
                <button className="reset-btn" onClick={() => onChange(defaultSettings)}>
                    恢复默认
                </button>
            </div>
        </>
    )
}

function SliderRow({ label, value, min, max, step, format, onChange }: {
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

/** 连接状态的状态文案，设置页与侧栏共用 */
export const STATUS_LABEL: Record<BackendStatus['state'], string> = {
    idle: '未连接',
    connecting: '正在连接…',
    connected: '已连接',
    reconnecting: '连接中断，正在重连…',
}

function UserPane({ settings, onChange }: {
    settings: UiSettings
    onChange: (p: Partial<UiSettings>) => void
}) {
    return (
        <>
            <header className="pane-head">
                <h2 className="pane-title">用户</h2>
                <p className="pane-desc">桌面频道身份，随每条消息发送到后端；后端的会话与记忆按它归属。</p>
            </header>

            <div className="pane-card">
                <FieldRow label="用户 ID">
                    <input
                        className="field-input"
                        value={settings.backendUserId}
                        placeholder="desktop"
                        spellCheck={false}
                        onChange={(e) => onChange({ backendUserId: e.target.value })}
                    />
                </FieldRow>
            </div>
        </>
    )
}

function GeneralPane({ settings, onChange }: { settings: UiSettings; onChange: (p: Partial<UiSettings>) => void }) {
    return (
        <>
            <header className="pane-head">
                <h2 className="pane-title">通用</h2>
                <p className="pane-desc">启动与输入行为，跟着配置文件走，重开后依然生效。</p>
            </header>

            <div className="pane-card">
                <SwitchRow
                    label="开机自启"
                    hint="登录系统后自动启动客户端；开发态注册的是 electron 本体，打包版才真正有意义"
                    checked={settings.startAtLogin}
                    onChange={(v) => onChange({ startAtLogin: v })}
                />
                <OptionRow
                    label="发送快捷键"
                    hint="选 Ctrl+Enter 时单独回车只换行，适合写长句"
                    value={settings.sendKey}
                    options={[
                        { value: 'enter', label: 'Enter' },
                        { value: 'ctrlEnter', label: 'Ctrl+Enter' },
                    ]}
                    onChange={(v) => onChange({ sendKey: v })}
                />
            </div>
        </>
    )
}

function ChatsPane({ settings, onChange, onClearLocal, onOpenDataDir }: {
    settings: UiSettings
    onChange: (p: Partial<UiSettings>) => void
    onClearLocal: () => void
    onOpenDataDir: () => Promise<void>
}) {
    return (
        <>
            <header className="pane-head">
                <h2 className="pane-title">会话</h2>
                <p className="pane-desc">本机历史只是缓存：真源在 core 的记忆里，清掉它不会影响后端与会话本身。</p>
            </header>

            <div className="pane-card">
                <SliderRow
                    label="每条对话保留消息"
                    value={settings.historyLimit}
                    min={HISTORY_LIMIT_MIN}
                    max={HISTORY_LIMIT_MAX}
                    step={20}
                    format={(v) => `${v} 条`}
                    onChange={(v) => onChange({ historyLimit: v })}
                />
            </div>

            <div className="pane-card">
                <ActionRow
                    label="打开数据目录"
                    hint="会话快照、设置文件与日志都在这里"
                    actionLabel="打开"
                    doneLabel="已打开"
                    onAction={onOpenDataDir}
                />
                <ActionRow
                    label="清空本地记录"
                    hint="删除本机快照，列表与消息一并清空；不可恢复"
                    actionLabel="清空"
                    doneLabel="已清空"
                    danger
                    onAction={onClearLocal}
                />
            </div>
        </>
    )
}

function NotificationsPane({ settings, onChange, onTestNotify }: {
    settings: UiSettings
    onChange: (p: Partial<UiSettings>) => void
    onTestNotify: () => Promise<void>
}) {
    return (
        <>
            <header className="pane-head">
                <h2 className="pane-title">通知</h2>
                <p className="pane-desc">只在窗口不在前台时打扰；正看着对话时不会弹。</p>
            </header>

            <div className="pane-card">
                <SwitchRow
                    label="回复到达时弹系统通知"
                    hint="系统层面关掉了应用通知权限时不会生效（Windows 设置 → 通知）"
                    checked={settings.notifyOnReply}
                    onChange={(v) => onChange({ notifyOnReply: v })}
                />
                <ActionRow
                    label="发送测试通知"
                    hint="窗口在前台也会弹，用来确认系统通知权限没被关掉"
                    actionLabel="测试"
                    doneLabel="已发送"
                    onAction={onTestNotify}
                />
            </div>
        </>
    )
}

/** 开关行：与滑块行同一套留白节奏，右侧是自绘开关 */
function SwitchRow({ label, hint, checked, onChange }: {
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
function OptionRow<T extends string>({ label, hint, value, options, onChange }: {
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
function ActionRow({ label, hint, actionLabel, doneLabel = '已完成', danger, onAction }: {
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

function BackendPane({ settings, onChange, status }: {
    settings: UiSettings
    onChange: (p: Partial<UiSettings>) => void
    status: BackendStatus
}) {
    return (
        <>
            <header className="pane-head">
                <h2 className="pane-title">后端连接</h2>
                <p className="pane-desc">桌面端与 core 的消息通道。协议握手接入前，这里只反映通道是否可达。</p>
            </header>

            <div className="pane-card">
                <FieldRow label="服务器地址">
                    <input
                        className="field-input"
                        value={settings.backendUrl}
                        placeholder="ws://127.0.0.1:2150"
                        spellCheck={false}
                        onChange={(e) => onChange({ backendUrl: e.target.value })}
                    />
                </FieldRow>
                <FieldRow label="Token">
                    <input
                        className="field-input"
                        type="password"
                        value={settings.backendToken}
                        placeholder="后端配置的连接 token"
                        autoComplete="off"
                        onChange={(e) => onChange({ backendToken: e.target.value })}
                    />
                </FieldRow>
                <div className="status-block">
                    <div className="status-row">
                        <span className={`status-dot ${status.state}`} />
                        <span className={`status-text ${status.state}`}>{STATUS_LABEL[status.state]}</span>
                    </div>
                    {status.message && (status.state === 'reconnecting' || status.state === 'idle') && (
                        <div className="status-hint">
                            {status.message}
                            {status.state === 'reconnecting' ? '——正在自动重连' : ''}
                        </div>
                    )}
                </div>
            </div>

            <div className="pane-foot">
                <p className="pane-desc">点「保存」应用并重连；连接由主进程常驻持有，关窗重开后自动恢复。</p>
            </div>
        </>
    )
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="field-row">
            <div className="field-head">
                <span className="field-label">{label}</span>
            </div>
            {children}
        </div>
    )
}

function AboutPane({ version }: { version: string }) {
    return (
        <>
            <header className="pane-head">
                <h2 className="pane-title">关于</h2>
            </header>
            <div className="reserved about">
                <BrandMark size={38} label="Cith" />
                <div>
                    <div className="about-name">Cith 桌面客户端</div>
                    <div className="about-line">v{version || '0.1.0'} · Electron + React</div>
                    <div className="about-line">与 packages/core/ 后端完全解耦，仅经 WS 协议通信（占位协议已接通）。</div>
                </div>
            </div>
        </>
    )
}
