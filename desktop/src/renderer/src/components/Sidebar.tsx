import { useEffect, useState, type MouseEvent } from 'react'
import type { Conversation } from '../types'
import { MoreIcon, PlusIcon, SlidersIcon } from './icons'
import './Sidebar.css'

type Props = {
    conversations: Conversation[]
    archived: Conversation[]
    activeId: string
    version: string
    settingsOpen: boolean
    onSelect: (id: string) => void
    onNew: () => void
    onOpenSettings: () => void
    onArchive: (id: string) => void
    onDelete: (id: string) => void
    onRestore: (id: string) => void
}

export function Sidebar({ conversations, archived, activeId, version, settingsOpen, onSelect, onNew, onOpenSettings, onArchive, onDelete, onRestore }: Props) {
    const [menuId, setMenuId] = useState<string | null>(null)
    const [menuFlip, setMenuFlip] = useState(false)

    // 菜单开着时点 Esc 收起
    useEffect(() => {
        if (!menuId) return
        const close = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setMenuId(null)
        }
        window.addEventListener('keydown', close)
        return () => window.removeEventListener('keydown', close)
    }, [menuId])

    function toggleMenu(e: MouseEvent<HTMLButtonElement>, id: string) {
        e.stopPropagation()
        const rect = e.currentTarget.getBoundingClientRect()
        // 靠底部的条目向上弹，避免被滚动容器裁掉
        setMenuFlip(rect.bottom > window.innerHeight - 170)
        setMenuId(menuId === id ? null : id)
    }

    function run(action: (id: string) => void, id: string) {
        setMenuId(null)
        action(id)
    }

    return (
        <aside className="sidebar">
            <div className="side-brand">
                <span className="brand-mark" />
                <span className="brand-name">Cith</span>
                <span className="side-status" title="后端连接尚未接入">
                    <span className="status-dot" />
                </span>
            </div>

            <button className="side-new" onClick={onNew}>
                <PlusIcon />
                <span>新对话</span>
            </button>

            <nav className="side-list">
                {conversations.map((c) => (
                    <div
                        key={c.id}
                        role="button"
                        tabIndex={0}
                        className={`conv${c.id === activeId ? ' active' : ''}${menuId === c.id ? ' menu-open' : ''}`}
                        onClick={() => onSelect(c.id)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') onSelect(c.id)
                        }}
                    >
                        <span className="conv-title">{c.title}</span>
                        <span className="conv-meta">{c.updated}</span>
                        <button
                            className="conv-more"
                            aria-label="会话菜单"
                            onClick={(e) => toggleMenu(e, c.id)}
                        >
                            <MoreIcon />
                        </button>
                        {menuId === c.id && (
                            <>
                                <div
                                    className="menu-backdrop"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        setMenuId(null)
                                    }}
                                />
                                <div
                                    className="conv-menu"
                                    style={menuFlip ? { bottom: 'calc(100% - 4px)' } : { top: 'calc(100% - 4px)' }}
                                >
                                    <button
                                        className="conv-menu-item"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            run(onArchive, c.id)
                                        }}
                                    >
                                        归档
                                    </button>
                                    <button
                                        className="conv-menu-item danger"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            run(onDelete, c.id)
                                        }}
                                    >
                                        删除
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                ))}
                {archived.length > 0 && (
                    <div className="archived-group">
                        <span className="archived-label">已归档</span>
                        {archived.map((c) => (
                            <button
                                key={c.id}
                                className="conv archived"
                                title="点击恢复到列表"
                                onClick={() => onRestore(c.id)}
                            >
                                <span className="conv-title">{c.title}</span>
                                <span className="conv-meta">{c.updated}</span>
                            </button>
                        ))}
                    </div>
                )}
            </nav>

            <div className="side-foot">
                <button className={`side-setting${settingsOpen ? ' active' : ''}`} onClick={onOpenSettings}>
                    <SlidersIcon />
                    <span>设置</span>
                </button>
                {version && <span className="side-version">v{version}</span>}
            </div>
        </aside>
    )
}
