import { useEffect, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { Conversation } from '../types'
import type { BackendStatus } from '../../../preload/api.ts'
import { SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, defaultSettings } from '../../../shared/settings.ts'
import { STATUS_LABEL } from './Settings'
import { BrandMark } from '@cith/ui'
import { MoreIcon, PlusIcon, SlidersIcon } from './icons'
import './Sidebar.css'

type Props = {
    conversations: Conversation[]
    archived: Conversation[]
    activeId: string
    version: string
    settingsOpen: boolean
    backendStatus: BackendStatus
    onSelect: (id: string) => void
    onNew: () => void
    onOpenSettings: () => void
    onArchive: (id: string) => void
    onDelete: (id: string) => void
    onRestore: (id: string) => void
    onSidebarResize: (width: number) => void
}

export function Sidebar({ conversations, archived, activeId, version, settingsOpen, backendStatus, onSelect, onNew, onOpenSettings, onArchive, onDelete, onRestore, onSidebarResize }: Props) {
    const [menuId, setMenuId] = useState<string | null>(null)
    const [menuFlip, setMenuFlip] = useState(false)

    // 拖拽调宽：指针捕获跟手，期间直接写 CSS 变量，松手才落设置
    function startResize(e: ReactPointerEvent<HTMLDivElement>) {
        e.preventDefault()
        const el = e.currentTarget
        el.setPointerCapture(e.pointerId)
        document.body.style.userSelect = 'none'
        const clampWidth = (x: number) => Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, x))
        let width = clampWidth(e.clientX)
        const move = (ev: PointerEvent) => {
            width = clampWidth(ev.clientX)
            document.documentElement.style.setProperty('--sidebar-width', `${width}px`)
        }
        const finish = () => {
            el.removeEventListener('pointermove', move)
            el.removeEventListener('pointerup', finish)
            el.removeEventListener('pointercancel', finish)
            document.body.style.userSelect = ''
            onSidebarResize(width)
        }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', finish)
        el.addEventListener('pointercancel', finish)
    }

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
                <BrandMark size={26} label="Cith" />
                <span
                    className="side-status"
                    title={`消息通道：${STATUS_LABEL[backendStatus.state]}${backendStatus.message ? `（${backendStatus.message}）` : ''}`}
                >
                    <span className={`status-dot ${backendStatus.state}`} />
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

            <div
                className="sidebar-resizer"
                title="拖拽调节宽度，双击复位"
                onPointerDown={startResize}
                onDoubleClick={() => onSidebarResize(defaultSettings.sidebarWidth)}
            />
        </aside>
    )
}
