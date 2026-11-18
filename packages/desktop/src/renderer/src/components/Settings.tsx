import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import QRCode from 'qrcode'
import {
    defaultSettings,
    HISTORY_LIMIT_MAX,
    HISTORY_LIMIT_MIN,
    SIDEBAR_WIDTH_MAX,
    SIDEBAR_WIDTH_MIN,
    type UiSettings,
} from '../../../shared/settings.ts'
import type { BackendStatus, DesktopApi } from '../../../preload/api.ts'
import type { CoreConfig, CoreLogLine, CoreStatus } from '../../../shared/core-types.ts'
import { BrandMark } from '@cith/ui'
import { CloseIcon } from './icons'
import './Settings.css'

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

const CATEGORIES = [
    { id: 'interface', label: '界面' },
    { id: 'general', label: '通用' },
    { id: 'chats', label: '会话' },
    { id: 'notifications', label: '通知' },
    { id: 'user', label: '用户' },
    { id: 'localcore', label: '本地核心' },
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
                        {cat.id === 'localcore' && <LocalCorePane settings={draft} onChange={edit} />}
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
            </header>

            <div className="pane-card">
                <OptionRow
                    label="主题"
                    value={settings.theme}
                    options={[
                        { value: 'dark', label: '深色' },
                        { value: 'light', label: '浅色' },
                    ]}
                    onChange={(v) => onChange({ theme: v })}
                />
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
                <SliderRow
                    label="侧栏宽度"
                    value={settings.sidebarWidth}
                    min={SIDEBAR_WIDTH_MIN}
                    max={SIDEBAR_WIDTH_MAX}
                    step={10}
                    format={(v) => `${v} px`}
                    onChange={(v) => onChange({ sidebarWidth: v })}
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
                <p className="pane-desc">随消息发送到后端的桌面频道身份。</p>
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
            </header>

            <div className="pane-card">
                <SwitchRow
                    label="开机自启"
                    checked={settings.startAtLogin}
                    onChange={(v) => onChange({ startAtLogin: v })}
                />
                <OptionRow
                    label="发送快捷键"
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
                    actionLabel="打开"
                    doneLabel="已打开"
                    onAction={onOpenDataDir}
                />
                <ActionRow
                    label="清空本地记录"
                    hint="清空后不可恢复"
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
                <p className="pane-desc">只在窗口不在前台时打扰。</p>
            </header>

            <div className="pane-card">
                <SwitchRow
                    label="回复到达时弹系统通知"
                    hint="系统通知权限被关时不会生效"
                    checked={settings.notifyOnReply}
                    onChange={(v) => onChange({ notifyOnReply: v })}
                />
                <ActionRow
                    label="发送测试通知"
                    hint="前台也会弹，用于验证权限"
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
                <p className="pane-desc">与远程 core 的消息通道。</p>
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
                <p className="pane-desc">保存后应用并重连。</p>
            </div>
        </>
    )
}

// ===== 本地内置核心 =====

/** core 进程状态 → 复用现有状态点/状态文案的 CSS 类与展示词 */
const CORE_STATUS_VIEW: Record<CoreStatus['state'], { dot: string; label: string }> = {
    stopped: { dot: 'idle', label: '未启动' },
    starting: { dot: 'connecting', label: '正在启动…' },
    running: { dot: 'connected', label: '运行中' },
    stopping: { dot: 'connecting', label: '正在停止…' },
    crashed: { dot: 'reconnecting', label: '已崩溃' },
}

/** 配置表单的草稿形状：数字与数组字段先按字符串编辑，保存时解析 */
type CoreDraft = {
    llmApiUrl: string
    chatModel: string
    aiApiKey: string
    owner: string
    selfId: string
    enableLongTermMemory: boolean
    enableOnebot: boolean
    wsPort: string
    enableWechat: boolean
    desktopPort: string
    webPort: string
    mcpServers: string
}

/** config.json → 表单草稿（缺失的键给中性默认显示） */
function loadCoreDraft(cfg: CoreConfig): CoreDraft {
    const web = (typeof cfg.web === 'object' && cfg.web !== null ? cfg.web : {}) as Record<string, unknown>
    return {
        llmApiUrl: String(cfg.llmApiUrl ?? ''),
        chatModel: String(cfg.chatModel ?? ''),
        aiApiKey: String(cfg.aiApiKey ?? ''),
        owner: Array.isArray(cfg.owner) ? cfg.owner.map(String).join(', ') : '',
        selfId: String(cfg.selfId ?? ''),
        enableLongTermMemory: cfg.enableLongTermMemory === true,
        enableOnebot: cfg.enableOnebot !== false,
        wsPort: String(cfg.wsPort ?? 8080),
        enableWechat: cfg.enableWechat !== false,
        desktopPort: String(cfg.desktopPort ?? 2147),
        webPort: String(web.port ?? 2145),
        mcpServers: Array.isArray(cfg.mcpServers) ? JSON.stringify(cfg.mcpServers, null, 2) : '',
    }
}

/** 表单草稿 → config.json 补丁；owner/mcpServers 留空表示不改动对应键 */
function toCorePatch(draft: CoreDraft): { patch: CoreConfig } | { error: string } {
    const patch: CoreConfig = {
        llmApiUrl: draft.llmApiUrl.trim(),
        chatModel: draft.chatModel.trim(),
        aiApiKey: draft.aiApiKey.trim(),
        selfId: draft.selfId.trim(),
        enableLongTermMemory: draft.enableLongTermMemory,
        enableOnebot: draft.enableOnebot,
        enableWechat: draft.enableWechat,
    }
    if (draft.owner.trim() !== '') {
        patch.owner = draft.owner.split(/[,，\s]+/).filter(Boolean)
    }
    for (const [key, text] of [['wsPort', draft.wsPort], ['desktopPort', draft.desktopPort], ['webPort', draft.webPort]] as const) {
        const port = Number(text)
        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
            return { error: `${key} 需要是 1~65535 的整数` }
        }
        if (key === 'webPort') {
            patch.web = { ...(typeof patch.web === 'object' ? patch.web : {}), port }
        }
        else {
            patch[key] = port
        }
    }
    if (draft.mcpServers.trim() !== '') {
        let parsed: unknown
        try {
            parsed = JSON.parse(draft.mcpServers)
        }
        catch (err) {
            return { error: `mcpServers 不是合法 JSON：${err instanceof Error ? err.message : String(err)}` }
        }
        if (!Array.isArray(parsed)) return { error: 'mcpServers 需要是 JSON 数组' }
        patch.mcpServers = parsed
    }
    return { patch }
}

/** 从日志行里提取微信登录二维码（URL 字符串），扫码成功后清除 */
function extractWechatQr(text: string, setQr: (url: string) => void): void {
    const match = text.match(/WechatBot(?:重新登录)?二维码:\s*(\S+)/)
    if (match) setQr(match[1])
    else if (/WechatBot已登录/.test(text)) setQr('')
}

function LocalCorePane({ settings, onChange }: {
    settings: UiSettings
    onChange: (p: Partial<UiSettings>) => void
}) {
    const [status, setStatus] = useState<CoreStatus>({ state: 'stopped' })
    const [logs, setLogs] = useState<CoreLogLine[]>([])
    const [qrUrl, setQrUrl] = useState('')
    const [qrImage, setQrImage] = useState('')
    const [draft, setDraft] = useState<CoreDraft | null>(null)
    const [configError, setConfigError] = useState('')
    const [savedHint, setSavedHint] = useState('')
    const logBoxRef = useRef<HTMLDivElement | null>(null)

    // 状态与日志：面板只在分类激活时挂载，挂载时从主进程缓冲补齐历史
    useEffect(() => {
        let alive = true
        window.desktop?.getCoreStatus?.().then((s) => { if (alive) setStatus(s) })
        window.desktop?.getCoreLogs?.().then((lines) => {
            if (!alive) return
            setLogs(lines)
            // 从缓冲尾部往回找最近一次二维码：先遇到「已登录」说明已扫码，不再展示旧码
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
        window.desktop?.getCoreConfig?.().then((cfg) => { if (alive) setDraft(loadCoreDraft(cfg)) })
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
        const parsed = toCorePatch(draft)
        if ('error' in parsed) {
            setConfigError(parsed.error)
            return
        }
        try {
            if (!window.desktop?.saveCoreConfig) throw bridgeMissing('saveCoreConfig')
            const merged = await window.desktop.saveCoreConfig(parsed.patch)
            setDraft(loadCoreDraft(merged))
            setSavedHint(status.state === 'running' || status.state === 'starting' ? '已保存——重启核心后生效' : '已保存')
        }
        catch (err) {
            setConfigError(err instanceof Error ? err.message : String(err))
        }
    }

    const view = CORE_STATUS_VIEW[status.state]

    return (
        <>
            <header className="pane-head">
                <h2 className="pane-title">本地核心</h2>
                <p className="pane-desc">在客户端里直接运行内置 core；本地模式下连接参数自动接线。</p>
            </header>

            <div className="pane-card">
                <OptionRow
                    label="消息通道"
                    hint="远程模式连接「后端连接」里填的地址"
                    value={settings.coreMode}
                    options={[
                        { value: 'remote', label: '远程后端' },
                        { value: 'local', label: '本地内置核心' },
                    ]}
                    onChange={(v) => onChange({ coreMode: v })}
                />
                <SwitchRow
                    label="随应用启动本地核心"
                    hint="仅本地模式生效"
                    checked={settings.coreAutoStart}
                    onChange={(v) => onChange({ coreAutoStart: v })}
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
                        setStatus(await window.desktop.startCore())
                    }}
                />
                <ActionRow
                    label="重启核心"
                    actionLabel="重启"
                    doneLabel="已重启"
                    onAction={async () => {
                        if (!window.desktop?.restartCore) throw bridgeMissing('restartCore')
                        setStatus(await window.desktop.restartCore())
                    }}
                />
                <ActionRow
                    label="停止核心"
                    actionLabel="停止"
                    doneLabel="已停止"
                    danger
                    onAction={async () => {
                        if (!window.desktop?.stopCore) throw bridgeMissing('stopCore')
                        setStatus(await window.desktop.stopCore())
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

            {draft && (
                <div className="pane-card">
                    <FieldRow label="模型地址 (llmApiUrl)">
                        <input
                            className="field-input"
                            value={draft.llmApiUrl}
                            placeholder="https://api.example.com/v1"
                            spellCheck={false}
                            onChange={(e) => editCore({ llmApiUrl: e.target.value })}
                        />
                    </FieldRow>
                    <FieldRow label="对话模型 (chatModel)">
                        <input
                            className="field-input"
                            value={draft.chatModel}
                            placeholder="模型名称"
                            spellCheck={false}
                            onChange={(e) => editCore({ chatModel: e.target.value })}
                        />
                    </FieldRow>
                    <FieldRow label="API Key (aiApiKey)">
                        <input
                            className="field-input"
                            type="password"
                            value={draft.aiApiKey}
                            placeholder="sk-…"
                            autoComplete="off"
                            onChange={(e) => editCore({ aiApiKey: e.target.value })}
                        />
                    </FieldRow>
                    <FieldRow label="管理员 QQ (owner，逗号分隔)">
                        <input
                            className="field-input"
                            value={draft.owner}
                            placeholder="10000, 10001"
                            spellCheck={false}
                            onChange={(e) => editCore({ owner: e.target.value })}
                        />
                    </FieldRow>
                    <FieldRow label="机器人 QQ (selfId)">
                        <input
                            className="field-input"
                            value={draft.selfId}
                            placeholder="机器人自己的 QQ 号"
                            spellCheck={false}
                            onChange={(e) => editCore({ selfId: e.target.value })}
                        />
                    </FieldRow>
                    <SwitchRow
                        label="长期记忆"
                        hint="需 Ollama 或兼容 embedding 接口"
                        checked={draft.enableLongTermMemory}
                        onChange={(v) => editCore({ enableLongTermMemory: v })}
                    />
                    <SwitchRow
                        label="QQ 接入 (OneBot)"
                        hint="NapCat 反向 WS 填 ws://本机IP:<端口>/onebot/v11/ws"
                        checked={draft.enableOnebot}
                        onChange={(v) => editCore({ enableOnebot: v })}
                    />
                    <FieldRow label="NapCat 端口 (wsPort)">
                        <input
                            className="field-input"
                            value={draft.wsPort}
                            inputMode="numeric"
                            onChange={(e) => editCore({ wsPort: e.target.value })}
                        />
                    </FieldRow>
                    <SwitchRow
                        label="微信接入"
                        hint="首次启动在下方扫码登录"
                        checked={draft.enableWechat}
                        onChange={(v) => editCore({ enableWechat: v })}
                    />
                    <FieldRow label="桌面端口 (desktopPort)">
                        <input
                            className="field-input"
                            value={draft.desktopPort}
                            inputMode="numeric"
                            onChange={(e) => editCore({ desktopPort: e.target.value })}
                        />
                    </FieldRow>
                    <FieldRow label="面板端口 (web.port)">
                        <input
                            className="field-input"
                            value={draft.webPort}
                            inputMode="numeric"
                            onChange={(e) => editCore({ webPort: e.target.value })}
                        />
                    </FieldRow>
                    <FieldRow label="MCP 服务器 (mcpServers，JSON 数组)">
                        <textarea
                            className="field-input core-textarea"
                            value={draft.mcpServers}
                            placeholder={'[{ "name": "websearch", "command": "$NODE", "args": ["node_modules/open-websearch/build/index.js"] }]'}
                            spellCheck={false}
                            onChange={(e) => editCore({ mcpServers: e.target.value })}
                        />
                    </FieldRow>
                </div>
            )}

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

            <div className="pane-foot">
                <button className="reset-btn" onClick={() => void saveConfig()}>保存核心配置</button>
                {configError && <span className="field-hint failure">{configError}</span>}
                {savedHint && <span className="field-hint">{savedHint}</span>}
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
                    <div className="about-line">v{version} · Electron + React</div>
                </div>
            </div>
        </>
    )
}
