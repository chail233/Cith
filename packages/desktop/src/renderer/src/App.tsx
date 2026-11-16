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

/** 连接配置下发给主进程；主进程不读 localStorage，启动同步与保存后下发都走这里 */
function pushBackend(s: UiSettings): void {
    window.desktop?.setBackend?.({ url: s.backendUrl, token: s.backendToken }).catch(() => {})
}

export default function App() {
    const [view, setView] = useState<'chat' | 'settings'>('chat')
    const [version, setVersion] = useState('')
    const [settings, setSettings] = useState<UiSettings>(loadSettings)
    const [backendStatus, setBackendStatus] = useState<BackendStatus>({ state: 'idle' })
    const conv = useConversations()
    const chat = useBackendChat(conv, settings.backendUserId)

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

    useEffect(() => {
        pushBackend(settings)
    }, [])

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

    function toggleSettings() {
        setView(view === 'settings' ? 'chat' : 'settings')
    }

    function handleSaveSettings(next: UiSettings) {
        setSettings(next)
        saveSettings(next)
        pushBackend(next)
    }

    useEffect(() => {
        if (view !== 'settings') return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setView('chat')
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [view])

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
                onOpenSettings={toggleSettings}
                onArchive={conv.archive}
                onDelete={conv.remove}
                onRestore={handleRestore}
            />
            {conv.active ? (
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
            {view === 'settings' && (
                <SettingsView
                    settings={settings}
                    onSave={handleSaveSettings}
                    version={version}
                    backendStatus={backendStatus}
                    onClose={() => setView('chat')}
                />
            )}
        </div>
    )
}
