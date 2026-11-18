import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import QRCode from 'qrcode'
import type { UiSettings } from '../../../shared/settings.ts'
import type { DesktopApi } from '../../../preload/api.ts'
import type { CoreConfig, CoreLogLine, CoreStatus } from '../../../shared/core-types.ts'
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


const CORE_STATUS_VIEW: Record<CoreStatus['state'], { dot: string; label: string }> = {
    stopped: { dot: 'idle', label: '未启动' },
    starting: { dot: 'connecting', label: '正在启动…' },
    running: { dot: 'connected', label: '运行中' },
    stopping: { dot: 'connecting', label: '正在停止…' },
    crashed: { dot: 'reconnecting', label: '已崩溃' },
}


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
    const [configError, setConfigError] = useState('')
    const [savedHint, setSavedHint] = useState('')
    const logBoxRef = useRef<HTMLDivElement | null>(null)
    
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
                <div className={tab === 'logs' ? 'core-body logs' : 'core-body'} key={tab}>
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

function ConfigTab({ draft, onEdit, onSave, configError, savedHint }: {
    draft: CoreDraft | null
    onEdit: (patch: Partial<CoreDraft>) => void
    onSave: () => void
    configError: string
    savedHint: string
}) {
    return (
        <>
            {draft && (
                <div className="pane-card">
                    <FieldRow label="模型地址 (llmApiUrl)">
                        <input
                            className="field-input"
                            value={draft.llmApiUrl}
                            placeholder="https://api.example.com/v1"
                            spellCheck={false}
                            onChange={(e) => onEdit({ llmApiUrl: e.target.value })}
                        />
                    </FieldRow>
                    <FieldRow label="对话模型 (chatModel)">
                        <input
                            className="field-input"
                            value={draft.chatModel}
                            placeholder="模型名称"
                            spellCheck={false}
                            onChange={(e) => onEdit({ chatModel: e.target.value })}
                        />
                    </FieldRow>
                    <FieldRow label="API Key (aiApiKey)">
                        <input
                            className="field-input"
                            type="password"
                            value={draft.aiApiKey}
                            placeholder="sk-…"
                            autoComplete="off"
                            onChange={(e) => onEdit({ aiApiKey: e.target.value })}
                        />
                    </FieldRow>
                    <FieldRow label="管理员 QQ (owner，逗号分隔)">
                        <input
                            className="field-input"
                            value={draft.owner}
                            placeholder="10000, 10001"
                            spellCheck={false}
                            onChange={(e) => onEdit({ owner: e.target.value })}
                        />
                    </FieldRow>
                    <FieldRow label="机器人 QQ (selfId)">
                        <input
                            className="field-input"
                            value={draft.selfId}
                            placeholder="机器人自己的 QQ 号"
                            spellCheck={false}
                            onChange={(e) => onEdit({ selfId: e.target.value })}
                        />
                    </FieldRow>
                    <SwitchRow
                        label="长期记忆"
                        hint="需 Ollama 或兼容 embedding 接口"
                        checked={draft.enableLongTermMemory}
                        onChange={(v) => onEdit({ enableLongTermMemory: v })}
                    />
                    <SwitchRow
                        label="QQ 接入 (OneBot)"
                        hint="NapCat 反向 WS 填 ws://本机IP:<端口>/onebot/v11/ws"
                        checked={draft.enableOnebot}
                        onChange={(v) => onEdit({ enableOnebot: v })}
                    />
                    <FieldRow label="NapCat 端口 (wsPort)">
                        <input
                            className="field-input"
                            value={draft.wsPort}
                            inputMode="numeric"
                            onChange={(e) => onEdit({ wsPort: e.target.value })}
                        />
                    </FieldRow>
                    <SwitchRow
                        label="微信接入"
                        hint="首次启动在「运行」页扫码登录"
                        checked={draft.enableWechat}
                        onChange={(v) => onEdit({ enableWechat: v })}
                    />
                    <FieldRow label="桌面端口 (desktopPort)">
                        <input
                            className="field-input"
                            value={draft.desktopPort}
                            inputMode="numeric"
                            onChange={(e) => onEdit({ desktopPort: e.target.value })}
                        />
                    </FieldRow>
                    <FieldRow label="面板端口 (web.port)">
                        <input
                            className="field-input"
                            value={draft.webPort}
                            inputMode="numeric"
                            onChange={(e) => onEdit({ webPort: e.target.value })}
                        />
                    </FieldRow>
                    <FieldRow label="MCP 服务器 (mcpServers，JSON 数组)">
                        <textarea
                            className="field-input core-textarea"
                            value={draft.mcpServers}
                            placeholder={'[{ "name": "websearch", "command": "$NODE", "args": ["node_modules/open-websearch/build/index.js"] }]'}
                            spellCheck={false}
                            onChange={(e) => onEdit({ mcpServers: e.target.value })}
                        />
                    </FieldRow>
                </div>
            )}

            <div className="pane-foot">
                <button className="reset-btn" onClick={onSave}>保存核心配置</button>
                {configError && <span className="field-hint failure">{configError}</span>}
                {savedHint && <span className="field-hint">{savedHint}</span>}
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
