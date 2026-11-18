import { useEffect, useState } from 'react'
import { applySettings } from './settings'
import { defaultSettings, mergeSettings, type UiSettings } from '../../shared/settings.ts'
import type { Segment } from './types'
import type { BackendStatus } from '../../preload/api.ts'
import { useConversations } from './useConversations'
import { useBackendChat } from './useBackendChat'
import { Sidebar } from './components/Sidebar'
import { ChatArea } from './components/Chat'
import { SettingsView } from './components/Settings'
import './styles/tokens.css'
import './styles/base.css'

/** 连接配置下发给主进程；设置加载完成与保存后都走这里 */
function pushBackend(s: UiSettings): void {
    window.desktop?.setBackend?.({ url: s.backendUrl, token: s.backendToken }).catch(() => {})
}

/** 旧版设置存在 renderer localStorage，文件仍是默认值时迁移一次进配置文件，随后清掉旧键 */
function migrateLegacy(stored: UiSettings): UiSettings {
    try {
        const legacy = JSON.parse(localStorage.getItem('cith-ui-settings') ?? '')
        if (typeof legacy !== 'object' || legacy === null) return stored
        if (JSON.stringify(stored) !== JSON.stringify(defaultSettings)) return stored
        localStorage.removeItem('cith-ui-settings')
        const merged = mergeSettings(legacy)
        window.desktop?.saveSettings?.(merged).catch(() => {})
        return merged
    }
    catch {
        return stored
    }
}

export default function App() {
    const [view, setView] = useState<'chat' | 'settings'>('chat')
    const [version, setVersion] = useState('')
    const [settings, setSettings] = useState<UiSettings>(defaultSettings)
    const [backendStatus, setBackendStatus] = useState<BackendStatus>({ state: 'idle' })
    const conv = useConversations(settings.historyLimit)
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

    // 设置从主进程取（配置文件在那里懒加载），加载完成后顺带同步连接配置
    useEffect(() => {
        window.desktop?.getSettings?.()
            .then((stored) => {
                const s = migrateLegacy(stored)
                setSettings(s)
                pushBackend(s)
            })
            .catch(() => {})
    }, [])

    function handleSend(text: string, extras: Segment[]) {
        if (!conv.active || backendStatus.state !== 'connected') return
        chat.send(conv.active.id, text, extras)
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

    function handleSidebarResize(width: number) {
        void handleSaveSettings({ ...settings, sidebarWidth: width })
    }

    async function handleSaveSettings(next: UiSettings) {
        let saved = next
        try {
            saved = (await window.desktop?.saveSettings?.(next)) ?? next
        }
        catch { /* 落盘失败也先让本会话生效 */ }
        setSettings(saved)
        pushBackend(saved)
    }

    /**
     * 打开数据目录。两种失败要分开报：
     * - 根本没有 window.desktop → 在浏览器里跑（dev:web），本来就没有主进程；
     * - 桥在但方法缺失 → 运行的是旧 preload，需要完全退出客户端再启动。
     */
    function handleOpenDataDir(): Promise<void> {
        const api = window.desktop
        if (!api) return Promise.reject(new Error('页面里没有主进程桥（浏览器调试模式），请在 Electron 客户端里使用'))
        if (typeof api.openDataDir !== 'function') {
            return Promise.reject(new Error('主进程桥是旧版本（缺 openDataDir），请完全退出客户端后重新启动'))
        }
        return api.openDataDir()
    }

    /** 测试系统通知：同样把「没有桥」与「桥太旧」分开 */
    function handleTestNotify(): Promise<void> {
        const api = window.desktop
        if (!api) return Promise.reject(new Error('页面里没有主进程桥（浏览器调试模式），请在 Electron 客户端里使用'))
        if (typeof api.notifyTest !== 'function') {
            return Promise.reject(new Error('主进程桥是旧版本（缺 notifyTest），请完全退出客户端后重新启动'))
        }
        api.notifyTest()
        return Promise.resolve()
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
                onSidebarResize={handleSidebarResize}
            />
            {conv.active ? (
                <ChatArea
                    key={conv.active.id}
                    conversation={conv.active}
                    pending={chat.pending}
                    connected={backendStatus.state === 'connected'}
                    sendKey={settings.sendKey}
                    onSend={handleSend}
                    onStop={chat.stop}
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
                    onClearLocal={conv.clearAll}
                    onOpenDataDir={handleOpenDataDir}
                    onTestNotify={handleTestNotify}
                    onClose={() => setView('chat')}
                />
            )}
        </div>
    )
}
