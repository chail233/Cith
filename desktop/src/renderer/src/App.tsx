import { useEffect, useState } from 'react'
import { applySettings, loadSettings, saveSettings, type UiSettings } from './settings'
import { useConversations } from './useConversations'
import { useDemoReply } from './useDemoReply'
import { Sidebar } from './components/Sidebar'
import { ChatArea } from './components/Chat'
import { SettingsView } from './components/Settings'
import './styles/tokens.css'
import './styles/base.css'

export default function App() {
    const [view, setView] = useState<'chat' | 'settings'>('chat')
    const [version, setVersion] = useState('')
    const [settings, setSettings] = useState<UiSettings>(loadSettings)
    const conv = useConversations()
    const demo = useDemoReply()

    useEffect(() => {
        window.desktop?.getVersion?.().then(setVersion).catch(() => {})
    }, [])

    useEffect(() => {
        applySettings(settings)
    }, [settings])

    function handleSend(text: string) {
        if (!conv.active || demo.pending) return
        const convId = conv.active.id
        conv.sendOutgoing(convId, text)
        demo.start(convId, conv)
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
                onSelect={handleSelect}
                onNew={handleNew}
                onOpenSettings={() => setView('settings')}
                onArchive={conv.archive}
                onDelete={conv.remove}
                onRestore={handleRestore}
            />
            {view === 'settings' ? (
                <SettingsView settings={settings} onChange={updateSettings} version={version} />
            ) : conv.active ? (
                <ChatArea key={conv.active.id} conversation={conv.active} pending={demo.pending} onSend={handleSend} />
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
