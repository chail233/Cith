import { useEffect, useRef, useState } from 'react'
import { initialConversations, type ChatMessage, type Conversation, type ToolTrace } from './mock/conversations'
import { applySettings, loadSettings, saveSettings, type UiSettings } from './settings'
import { Sidebar } from './components/Sidebar'
import { ChatArea } from './components/Chat'
import { SettingsView } from './components/Settings'
import './styles/tokens.css'
import './styles/base.css'
import './App.css'

let seq = 0
function nextId() {
    seq += 1
    return `m${Date.now().toString(36)}-${seq}`
}

function nowTime() {
    return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function App() {
    const [conversations, setConversations] = useState<Conversation[]>(initialConversations)
    const [activeId, setActiveId] = useState(initialConversations[0]?.id ?? '')
    const [pending, setPending] = useState(false)
    const [version, setVersion] = useState('')
    const [view, setView] = useState<'chat' | 'settings'>('chat')
    const [settings, setSettings] = useState<UiSettings>(loadSettings)
    const [archived, setArchived] = useState<Conversation[]>([])
    const timers = useRef<number[]>([])

    useEffect(() => {
        window.desktop?.getVersion?.().then(setVersion).catch(() => {})
        return () => timers.current.forEach((t) => clearTimeout(t))
    }, [])

    useEffect(() => {
        applySettings(settings)
    }, [settings])

    const active = conversations.find((c) => c.id === activeId) ?? conversations[0]

    function appendMessage(convId: string, msg: ChatMessage) {
        setConversations((list) =>
            list.map((c) => (c.id === convId ? { ...c, messages: [...c.messages, msg] } : c)),
        )
    }

    function updateLastTrace(convId: string, patch: Partial<ToolTrace>) {
        setConversations((list) =>
            list.map((c) => {
                if (c.id !== convId || c.messages.length === 0) return c
                const last = c.messages[c.messages.length - 1]
                const segs = last.segments
                for (let j = segs.length - 1; j >= 0; j--) {
                    const seg = segs[j]
                    if (seg.kind === 'trace') {
                        const newSegs = [...segs]
                        newSegs[j] = { ...seg, ...patch }
                        return {
                            ...c,
                            messages: [...c.messages.slice(0, -1), { ...last, segments: newSegs }],
                        }
                    }
                }
                return c
            }),
        )
    }

    function handleSend(text: string) {
        if (!active || pending) return
        const convId = active.id

        // 新对话的第一句话升级为标题
        if (active.title === '新对话') {
            const title = text.length > 18 ? `${text.slice(0, 18)}…` : text
            setConversations((list) =>
                list.map((c) => (c.id === convId ? { ...c, title, updated: '刚刚' } : c)),
            )
        }

        appendMessage(convId, {
            id: nextId(),
            role: 'user',
            time: nowTime(),
            segments: [{ kind: 'text', text }],
        })
        setPending(true)

        // 演示节奏：思考 → 工具痕迹（运行中→完成）→ 回复
        timers.current.push(window.setTimeout(() => {
            appendMessage(convId, {
                id: nextId(),
                role: 'agent',
                time: nowTime(),
                segments: [
                    { kind: 'trace', name: 'run_shell', summary: 'tail -n 30 构建日志', status: 'running' },
                ],
            })
        }, 900))

        timers.current.push(window.setTimeout(() => {
            updateLastTrace(convId, {
                status: 'ok',
                durationMs: 1240,
                command: 'npm run build',
                output: '> tsc -b && electron-vite build\n\n✓ built in 71ms',
            })
        }, 2300))

        timers.current.push(window.setTimeout(() => {
            appendMessage(convId, {
                id: nextId(),
                role: 'agent',
                time: nowTime(),
                segments: [
                    {
                        kind: 'text',
                        text: '这是演示模式的回复——后端协议接通后，这里会是真实的模型输出与工具调用。消息、工具痕迹、输入区的节奏感觉如何？',
                    },
                ],
            })
            setPending(false)
        }, 3100))
    }

    function handleNew() {
        const conv: Conversation = {
            id: `c${Date.now().toString(36)}`,
            title: '新对话',
            updated: '刚刚',
            messages: [],
        }
        setConversations((list) => [conv, ...list])
        setActiveId(conv.id)
        setView('chat')
    }

    function handleSelect(id: string) {
        setActiveId(id)
        setView('chat')
    }

    // 归档：从列表收起（本会话内存里保留，恢复入口后做）；删除：直接移除
    function handleArchive(id: string) {
        const target = conversations.find((c) => c.id === id)
        if (!target) return
        setConversations((list) => list.filter((c) => c.id !== id))
        setArchived((a) => [target, ...a])
        if (activeId === id) setActiveId(conversations.find((c) => c.id !== id)?.id ?? '')
    }

    function handleDelete(id: string) {
        setConversations((list) => list.filter((c) => c.id !== id))
        if (activeId === id) setActiveId(conversations.find((c) => c.id !== id)?.id ?? '')
    }

    function handleRestore(id: string) {
        const target = archived.find((c) => c.id === id)
        if (!target) return
        setArchived((a) => a.filter((c) => c.id !== id))
        setConversations((list) => [target, ...list])
        setActiveId(id)
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
                conversations={conversations}
                archived={archived}
                activeId={active?.id ?? ''}
                version={version}
                settingsOpen={view === 'settings'}
                onSelect={handleSelect}
                onNew={handleNew}
                onOpenSettings={() => setView('settings')}
                onArchive={handleArchive}
                onDelete={handleDelete}
                onRestore={handleRestore}
            />
            {view === 'settings' ? (
                <SettingsView settings={settings} onChange={updateSettings} version={version} />
            ) : active ? (
                <ChatArea key={active.id} conversation={active} pending={pending} onSend={handleSend} />
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
