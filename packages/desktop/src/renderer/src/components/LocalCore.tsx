import { Fragment, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import QRCode from 'qrcode'
import type { UiSettings } from '../../../shared/settings.ts'
import type { DesktopApi } from '../../../preload/api.ts'
import type { CoreLogLine, CoreStatus } from '../../../shared/core-types.ts'
import { CFG_GROUPS, loadCoreDraft, toCorePatch, type CoreDraft, type FieldSpec } from '../core-config.ts'
import { ActionRow, FieldRow, OptionRow, SwitchRow } from './rows'
import { CloseIcon } from './icons'
import './LocalCore.css'

/**
 * 桌面桥缺失的统一报错，区分两种成因：
 * dev:web（浏览器预览，整个 window.desktop 都不存在）与旧版客户端（桥还在但没有新方法，需重启/重建）
 */
function bridgeMissing(method: keyof DesktopApi): Error {
    if (!window.desktop) {
        return new Error('桌面桥不可用——浏览器预览模式没有主进程，请在 Electron 客户端里操作')
    }
    return new Error(`客户端缺少 ${method} 能力——请重启客户端或重新构建后再试`)
}

/** core 进程状态 → 复用现有状态点/状态文案的 CSS 类与展示词 */
const CORE_STATUS_VIEW: Record<CoreStatus['state'], { dot: string; label: string }> = {
    stopped: { dot: 'idle', label: '未启动' },
    starting: { dot: 'connecting', label: '正在启动…' },
    running: { dot: 'connected', label: '运行中' },
    stopping: { dot: 'connecting', label: '正在停止…' },
    crashed: { dot: 'reconnecting', label: '已崩溃' },
}

/** 从日志行里提取微信登录二维码（URL 字符串），扫码成功后清除 */
function extractWechatQr(text: string, setQr: (url: string) => void): void {
    const match = text.match(/WechatBot(?:重新登录)?二维码:\s*(\S+)/)
    if (match) setQr(match[1])
    else if (/WechatBot已登录/.test(text)) setQr('')
}

const TABS = [
    { id: 'run', label: '运行' },
    { id: 'config', label: '配置' },
    { id: 'logs', label: '日志' },
] as const

type TabId = (typeof TABS)[number]['id']

type Props = {
    settings: UiSettings
    onSaveSettings: (next: UiSettings) => void
    onClose: () => void
}

export function LocalCoreView({ settings, onSaveSettings, onClose }: Props) {
    const [tab, setTab] = useState<TabId>('run')
    const [status, setStatus] = useState<CoreStatus>({ state: 'stopped' })
    const [logs, setLogs] = useState<CoreLogLine[]>([])
    const [qrUrl, setQrUrl] = useState('')
    const [qrImage, setQrImage] = useState('')
    const [draft, setDraft] = useState<CoreDraft | null>(null)
    const initialRef = useRef<CoreDraft | null>(null)
    const [configError, setConfigError] = useState('')
    const [savedHint, setSavedHint] = useState('')
    const logBoxRef = useRef<HTMLDivElement | null>(null)

    // 状态与日志：视图打开期间持续订阅，切页不断，日志在缓冲尾部捞微信二维码
    useEffect(() => {
        let alive = true
        window.desktop?.getCoreStatus?.().then((s) => { if (alive) setStatus(s) })
        window.desktop?.getCoreLogs?.().then((lines) => {
            if (!alive) return
            setLogs(lines)
            for (const line of [...lines].reverse()) {
                const match = line.text.match(/WechatBot(?:重新登录)?二维码:\s*(\S+)/)
                if (match) {
                    setQrUrl(match[1])
                    break
                }
                if (/WechatBot已登录/.test(line.text)) break
            }
        })
        const offStatus = window.desktop?.onCoreStatus?.(setStatus)
        const offLog = window.desktop?.onCoreLog?.((line) => {
            setLogs((prev) => [...prev.slice(-499), line])
            extractWechatQr(line.text, setQrUrl)
        })
        return () => {
            alive = false
            offStatus?.()
            offLog?.()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // 配置草稿只加载一次（保存后由返回的合并结果刷新）
    useEffect(() => {
        let alive = true
        window.desktop?.getCoreConfig?.().then((cfg) => {
            if (!alive) return
            const d = loadCoreDraft(cfg)
            initialRef.current = d
            setDraft(d)
        })
        return () => { alive = false }
    }, [])

    // 二维码 URL → 离屏渲染成图
    useEffect(() => {
        if (!qrUrl) {
            setQrImage('')
            return
        }
        let alive = true
        QRCode.toDataURL(qrUrl, { width: 220, margin: 1 })
            .then((url) => { if (alive) setQrImage(url) })
            .catch(() => { if (alive) setQrImage('') })
        return () => { alive = false }
    }, [qrUrl])

    // 日志跟随滚动到底部
    useEffect(() => {
        const box = logBoxRef.current
        if (box) box.scrollTop = box.scrollHeight
    }, [logs])

    function editCore(patch: Partial<CoreDraft>): void {
        setSavedHint('')
        setConfigError('')
        setDraft((d) => (d ? { ...d, ...patch } : d))
    }

    async function saveConfig(): Promise<void> {
        if (!draft) return
        const parsed = toCorePatch(draft, initialRef.current)
        if ('error' in parsed) {
            setConfigError(parsed.error)
            return
        }
        try {
            if (!window.desktop?.saveCoreConfig) throw bridgeMissing('saveCoreConfig')
            const merged = await window.desktop.saveCoreConfig(parsed.patch)
            const d = loadCoreDraft(merged)
            initialRef.current = d
            setDraft(d)
            setSavedHint(status.state === 'running' || status.state === 'starting' ? '已保存——重启核心后生效' : '已保存')
        }
        catch (err) {
            setConfigError(err instanceof Error ? err.message : String(err))
        }
    }

    return (
        <div className="settings-overlay" onClick={onClose}>
            <main className="core-view" role="dialog" aria-modal="true" aria-label="本地核心" onClick={(e) => e.stopPropagation()}>
                <header className="core-head">
                    <h1 className="core-title">本地核心</h1>
                    <button className="settings-close" aria-label="关闭本地核心" onClick={onClose}>
                        <CloseIcon />
                    </button>
                </header>
                <nav className="core-tabs">
                    {TABS.map((t) => (
                        <button
                            key={t.id}
                            className={`set-cat${t.id === tab ? ' active' : ''}`}
                            onClick={() => setTab(t.id)}
                        >
                            <span>{t.label}</span>
                        </button>
                    ))}
                </nav>
                <div className={tab === 'logs' ? 'core-body logs' : tab === 'config' ? 'core-body config' : 'core-body'} key={tab}>
                    {tab === 'run' && (
                        <RunTab settings={settings} onSaveSettings={onSaveSettings} status={status} onStatus={setStatus} qrImage={qrImage} />
                    )}
                    {tab === 'config' && (
                        <ConfigTab draft={draft} onEdit={editCore} onSave={() => void saveConfig()} configError={configError} savedHint={savedHint} />
                    )}
                    {tab === 'logs' && <LogsTab logs={logs} logBoxRef={logBoxRef} />}
                </div>
            </main>
        </div>
    )
}

function RunTab({ settings, onSaveSettings, status, onStatus, qrImage }: {
    settings: UiSettings
    onSaveSettings: (next: UiSettings) => void
    status: CoreStatus
    onStatus: (s: CoreStatus) => void
    qrImage: string
}) {
    const view = CORE_STATUS_VIEW[status.state]
    return (
        <>
            <div className="pane-card">
                <OptionRow
                    label="消息通道"
                    hint="远程模式连接「后端连接」里填的地址"
                    value={settings.coreMode}
                    options={[
                        { value: 'remote', label: '远程后端' },
                        { value: 'local', label: '本地内置核心' },
                    ]}
                    onChange={(v) => onSaveSettings({ ...settings, coreMode: v })}
                />
                <SwitchRow
                    label="随应用启动本地核心"
                    hint="仅本地模式生效"
                    checked={settings.coreAutoStart}
                    onChange={(v) => onSaveSettings({ ...settings, coreAutoStart: v })}
                />
                <div className="status-block">
                    <div className="status-row">
                        <span className={`status-dot ${view.dot}`} />
                        <span className={`status-text ${view.dot}`}>{view.label}</span>
                        {status.state === 'running' && status.pid && <span className="status-hint" style={{ marginTop: 0 }}>pid {status.pid}</span>}
                    </div>
                    {status.message && <div className="status-hint">{status.message}</div>}
                </div>
            </div>

            <div className="pane-card">
                <ActionRow
                    label="启动核心"
                    actionLabel="启动"
                    doneLabel="已启动"
                    onAction={async () => {
                        if (!window.desktop?.startCore) throw bridgeMissing('startCore')
                        onStatus(await window.desktop.startCore())
                    }}
                />
                <ActionRow
                    label="重启核心"
                    actionLabel="重启"
                    doneLabel="已重启"
                    onAction={async () => {
                        if (!window.desktop?.restartCore) throw bridgeMissing('restartCore')
                        onStatus(await window.desktop.restartCore())
                    }}
                />
                <ActionRow
                    label="停止核心"
                    actionLabel="停止"
                    doneLabel="已停止"
                    danger
                    onAction={async () => {
                        if (!window.desktop?.stopCore) throw bridgeMissing('stopCore')
                        onStatus(await window.desktop.stopCore())
                    }}
                />
                <ActionRow
                    label="打开核心配置目录"
                    actionLabel="打开"
                    doneLabel="已打开"
                    onAction={async () => {
                        if (!window.desktop?.openCoreConfigDir) throw bridgeMissing('openCoreConfigDir')
                        await window.desktop.openCoreConfigDir()
                    }}
                />
            </div>

            {qrImage && (
                <div className="pane-card">
                    <span className="field-label">微信扫码登录</span>
                    <div className="core-qr">
                        <img src={qrImage} alt="微信登录二维码" />
                    </div>
                    <span className="field-hint">过期自动刷新，登录成功后消失</span>
                </div>
            )}
        </>
    )
}

/** 配置页：左侧分组导航 + 右侧表单；字段全部由 CFG_GROUPS 声明式驱动 */
function ConfigTab({ draft, onEdit, onSave, configError, savedHint }: {
    draft: CoreDraft | null
    onEdit: (patch: Partial<CoreDraft>) => void
    onSave: () => void
    configError: string
    savedHint: string
}) {
    const [group, setGroup] = useState(CFG_GROUPS[0])
    const active = CFG_GROUPS.find((g) => g.id === group.id) ?? CFG_GROUPS[0]

    function renderField(field: FieldSpec) {
        if (field.showIf && String(draft?.[field.showIf.key]) !== field.showIf.equals) return null
        const value = String(draft?.[field.key] ?? '')
        let control: ReactNode
        if (field.kind === 'switch') {
            control = (
                <SwitchRow
                    label={field.label}
                    hint={field.hint}
                    checked={Boolean(draft?.[field.key])}
                    onChange={(v) => onEdit({ [field.key]: v } as Partial<CoreDraft>)}
                />
            )
        }
        else if (field.kind === 'option') {
            control = (
                <OptionRow
                    label={field.label}
                    hint={field.hint}
                    value={value}
                    options={field.options}
                    onChange={(v) => onEdit({ [field.key]: v } as Partial<CoreDraft>)}
                />
            )
        }
        else if (field.kind === 'json' || field.kind === 'kv') {
            control = (
                <FieldRow label={field.label} hint={field.hint}>
                    <textarea
                        className="field-input core-textarea"
                        value={value}
                        placeholder={field.kind === 'kv' ? '10000=张三' : field.placeholder}
                        spellCheck={false}
                        onChange={(e) => onEdit({ [field.key]: e.target.value } as Partial<CoreDraft>)}
                    />
                </FieldRow>
            )
        }
        else {
            control = (
                <FieldRow label={field.label} hint={field.hint}>
                    <input
                        className="field-input"
                        type={field.kind === 'secret' ? 'password' : 'text'}
                        inputMode={field.kind === 'number' ? 'decimal' : undefined}
                        value={value}
                        placeholder={field.placeholder}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => onEdit({ [field.key]: e.target.value } as Partial<CoreDraft>)}
                    />
                </FieldRow>
            )
        }
        // 双列网格里，标 wide 的字段横跨两列
        if (field.wide) return <div className="field-wide" key={field.key}>{control}</div>
        return <Fragment key={field.key}>{control}</Fragment>
    }

    return (
        <>
            <div className="cfg-nav">
                {CFG_GROUPS.map((g) => (
                    <button
                        key={g.id}
                        className={`set-cat${g.id === active.id ? ' active' : ''}`}
                        onClick={() => setGroup(g)}
                    >
                        <span>{g.label}</span>
                    </button>
                ))}
            </div>
            <div className="cfg-pane" key={active.id}>
                <header className="pane-head">
                    <h2 className="pane-title">{active.label}</h2>
                    <p className="pane-desc">{active.desc}</p>
                </header>
                {draft ? (
                    <div className="pane-card">
                        {active.fields.map(renderField)}
                    </div>
                ) : (
                    <div className="pane-card">
                        <span className="field-hint">配置加载中…（浏览器预览没有主进程，读不到核心配置）</span>
                    </div>
                )}
                <div className="pane-foot">
                    <button className="reset-btn" onClick={onSave}>保存核心配置</button>
                    {configError && <span className="field-hint failure">{configError}</span>}
                    {savedHint && <span className="field-hint">{savedHint}</span>}
                </div>
            </div>
        </>
    )
}

function LogsTab({ logs, logBoxRef }: {
    logs: CoreLogLine[]
    logBoxRef: MutableRefObject<HTMLDivElement | null>
}) {
    return (
        <div className="pane-card">
            <div className="field-row">
                <div className="field-head">
                    <span className="field-label">启动日志</span>
                </div>
                <div className="core-log" ref={logBoxRef}>
                    {logs.length === 0
                        ? <span className="field-hint">暂无日志</span>
                        : logs.map((line, i) => (
                            <div className="core-log-line" key={`${line.ts}-${i}`}>{line.text}</div>
                        ))}
                </div>
            </div>
        </div>
    )
}
