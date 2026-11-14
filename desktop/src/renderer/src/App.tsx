import { useEffect, useState } from 'react'
import { applySettings, loadSettings, saveSettings, type UiSettings } from './settings'
import type { BackendStatus } from '../../preload/api.ts'
import { useConversations } from './useConversations'
import { useBackendChat } from './useBackendChat'
import { Sidebar } from './components/Sidebar'
import { ChatArea } from './components/Chat'
import { SettingsView } from './components/Settings'
import './styles/tokens.css'
import './styles/base.css'

export default function App() {
    const [view, setView] = useState<'chat' | 'settings'>('chat')
    const [version, setVersion] = useState('')
    const [settings, setSettings] = useState<UiSettings>(loadSettings)
    const [backendStatus, setBackendStatus] = useState<BackendStatus>({ state: 'idle' })
    const conv = useConversations()
    const chat = useBackendChat(conv)

    useEffect(() => {
        window.desktop?.getVersion?.().then(setVersion).catch(() => {})
    }, [])

    useEffect(() => {
        applySettings(settings)
    }, [settings])

    // 订阅消息通道状态并拉一次快照；dev:web 无主进程，整链可选链短路
    useEffect(() => {
        const unsub = window.desktop?.onBackendStatus?.(setBackendStatus)
        window.desktop?.getBackendStatus?.().then(setBackendStatus).catch(() => {})
        return () => unsub?.()
    }, [])

    // 连接配置随设置实时下发，主进程防抖重连
    useEffect(() => {
        window.desktop?.setBackend?.({ url: settings.backendUrl, token: settings.backendToken }).catch(() => {})
    }, [settings.backendUrl, settings.backendToken])

    function handleSend(text: string) {
        if (!conv.active || chat.pending || backendStatus.state !== 'connected') return
        chat.send(conv.active.id, text)
    }

    function handleNew() {
        conv.create()
        setView('chat')
    }

    function handleSelect(id: string) {
        conv.select(id)
        setView('chat')
    }

    function handleRestore(id: string) {
        conv.restore(id)
        setView('chat')
    }

    function updateSettings(patch: Partial<UiSettings>) {
        setSettings((s) => {
            const next = { ...s, ...patch }
            saveSettings(next)
            return next
        })
    }

    return (
        <div className="app">
                <Sidebar
                    conversations={conv.conversations}
                    archived={conv.archived}
                    activeId={conv.active?.id ?? ''}
                    version={version}
                    settingsOpen={view === 'settings'}
                    backendStatus={backendStatus}
                    onSelect={handleSelect}
                onNew={handleNew}
                onOpenSettings={() => setView('settings')}
                onArchive={conv.archive}
                onDelete={conv.remove}
                onRestore={handleRestore}
            />
            {view === 'settings' ? (
                <SettingsView settings={settings} onChange={updateSettings} version={version} backendStatus={backendStatus} />
            ) : conv.active ? (
                <ChatArea
                    key={conv.active.id}
                    conversation={conv.active}
                    pending={chat.pending}
                    connected={backendStatus.state === 'connected'}
                    onSend={handleSend}
                />
            ) : (
                <main className="chat">
                    <div className="empty">
                        <span className="empty-mark" />
                        <h2 className="empty-title">没有会话了</h2>
                        <p className="empty-sub">从左侧新建一个对话吧</p>
                    </div>
                </main>
            )}
        </div>
    )
}
