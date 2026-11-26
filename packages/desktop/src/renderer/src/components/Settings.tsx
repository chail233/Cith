import { useState, type CSSProperties } from 'react'
import {
    defaultSettings,
    HISTORY_LIMIT_MAX,
    HISTORY_LIMIT_MIN,
    SIDEBAR_WIDTH_MAX,
    SIDEBAR_WIDTH_MIN,
    type UiSettings,
} from '../../../shared/settings.ts'
import type { BackendStatus } from '../../../preload/api.ts'
import type { DesktopUpdateState, DesktopUpdateStatus } from '../../../shared/update.ts'
import { BrandMark } from '@cith/ui'
import { AvatarRow } from './AvatarRow'
import { Message } from './Message'
import { CloseIcon } from './icons'
import { ActionRow, FieldRow, OptionRow, SliderRow, SwitchRow } from './rows'
import './Settings.css'

const CATEGORIES = [
    { id: 'interface', label: '界面' },
    { id: 'personal', label: '个性化' },
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
    initialCategory: 'interface' | 'about'
    backendStatus: BackendStatus
    updateState?: DesktopUpdateState
    onClearLocal: () => void
    onOpenDataDir: () => Promise<void>
    onTestNotify: () => Promise<void>
    onClose: () => void
}

export function SettingsView({ settings, onSave, version, initialCategory, backendStatus, updateState, onClearLocal, onOpenDataDir, onTestNotify, onClose }: Props) {
    const [active, setActive] = useState<string>(initialCategory)
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
                        {cat.id === 'personal' && (
                            <>
                                <header className="pane-head"><h2 className="pane-title">个性化</h2></header>
                                <div className="pane-card">
                                    <AvatarRow role="user" value={draft.userAvatar} onChange={(userAvatar) => edit({ userAvatar })} />
                                    <AvatarRow role="agent" value={draft.agentAvatar} onChange={(agentAvatar) => edit({ agentAvatar })} />
                                </div>
                                <div className="pane-card">
                                    <SwitchRow label="聊天气泡" checked={draft.chatBubbles} onChange={(chatBubbles) => edit({ chatBubbles })} />
                                    <SwitchRow label="拟人回复节奏" hint="新回复按消息段依次显示，文字越长，停顿越久。"
                                        checked={draft.pacedReplies} onChange={(pacedReplies) => edit({ pacedReplies })} />
                                </div>
                                <ChatPreview settings={draft} />
                            </>
                        )}
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
                        {cat.id === 'about' && (
                            <AboutPane version={version} settings={draft} onChange={edit} updateState={updateState} />
                        )}
                    </section>
                </div>
            </main>
        </div>
    )
}

function ChatPreview({ settings }: { settings: UiSettings }) {
    return (
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
                <Message settings={settings} msg={{ id: 'user', role: 'user', time: '', segments: [
                    { type: 'text', data: { text: '今晚读点什么？' } },
                ] }} />
                <Message settings={settings} msg={{ id: 'agent', role: 'agent', time: '', segments: [
                    { type: 'text', data: { text: '读一篇短篇吧。\n\n你想看科幻，还是推理？' } },
                ] }} />
            </div>
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

            <ChatPreview settings={settings} />

            <div className="pane-foot">
                <button className="reset-btn" onClick={() => onChange(defaultSettings)}>
                    恢复默认
                </button>
            </div>
        </>
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
                    label="关闭窗口时"
                    hint="隐藏到托盘后仍保持运行，可从托盘重新打开或退出。"
                    value={settings.windowCloseAction}
                    options={[
                        { value: 'quit', label: '退出应用' },
                        { value: 'tray', label: '隐藏到托盘' },
                    ]}
                    onChange={(v) => onChange({ windowCloseAction: v })}
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

function AboutPane({ version, settings, onChange, updateState }: {
    version: string
    settings: UiSettings
    onChange: (p: Partial<UiSettings>) => void
    updateState?: DesktopUpdateState
}) {
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
            {updateState && updateState.mode !== 'unsupported' && (
                <div className="pane-card">
                    <UpdateRow state={updateState} />
                    {updateState.mode === 'installer' && (
                        <SwitchRow
                            label="自动下载更新"
                            hint="保存后生效。发现新版本时在后台下载，安装前会询问。"
                            checked={settings.autoDownloadUpdates}
                            onChange={(v) => onChange({ autoDownloadUpdates: v })}
                        />
                    )}
                </div>
            )}
        </>
    )
}

export function updateStatusLabel(status: DesktopUpdateStatus): string {
    switch (status.phase) {
        case 'idle': return '应用更新'
        case 'checking': return '正在检查更新…'
        case 'current': return '当前没有可用更新'
        case 'available': return `发现新版本 v${status.version}`
        case 'downloading': return `正在下载 v${status.version}`
        case 'downloaded': return `v${status.version} 已下载`
        case 'installing': return '正在准备重启…'
        case 'error': return '检查更新失败'
    }
}

function UpdateRow({ state: { mode, status } }: { state: DesktopUpdateState }) {
    const [actionError, setActionError] = useState('')
    const api = window.desktop
    let action: { label: string; run: () => Promise<void> } | undefined
    if (api && status.phase === 'available') {
        const label = mode === 'portable' ? '前往下载' : status.error ? '重试下载' : '下载更新'
        action = { label, run: api.downloadUpdate }
    }
    else if (api && status.phase === 'downloaded') {
        action = { label: '重启更新', run: api.installUpdate }
    }
    else if (api && (status.phase === 'idle' || status.phase === 'current' || status.phase === 'error')) {
        action = { label: '检查更新', run: api.checkForUpdates }
    }

    const error = actionError || ('error' in status ? status.error : undefined)
    const progress = status.phase === 'downloading' ? status.percent : undefined
    return (
        <>
            <div className="action-row">
                <div className="switch-text" role="status">
                    <span className="field-label">{updateStatusLabel(status)}</span>
                    {error && <span className="field-hint failure">{error}</span>}
                </div>
                {progress !== undefined && <span className="slider-value">{progress}%</span>}
                {action && (
                    <button className="action-btn" onClick={() => {
                        setActionError('')
                        void action.run().catch(() => setActionError('无法执行更新操作，请重试。'))
                    }}>
                        {action.label}
                    </button>
                )}
            </div>
            {status.phase === 'downloading' && (
                <progress className="update-progress" aria-label="更新下载进度" max={100} value={progress} />
            )}
        </>
    )
}
