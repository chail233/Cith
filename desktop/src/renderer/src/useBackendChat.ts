import { useEffect, useRef, useState } from 'react'
import { nextId, nowTime, type ConversationsStore } from './useConversations'
import type { Segment } from './types'
import type { IncomingMessageFrame, OutgoingMessageFrame } from '../../preload/api.ts'

/** 桌面频道的占位身份：单用户通道，后端会话归属靠它保持稳定 */
const DESKTOP_USER_ID = 'desktop'
/** 发出后等待回复的兜底窗口：超时解锁输入，避免服务端无回复时卡死 */
const REPLY_TIMEOUT_MS = 120_000

/**
 * 消息通道会话桥：出站帧由缝里构建的段数组直装，入站帧转成渲染段进会话。
 * 会话归属：优先回复最近一次发送的会话，其次按 space.id 记忆映射，都没有落到当前会话。
 */
export function useBackendChat(store: ConversationsStore) {
    const [pending, setPending] = useState(false)
    const storeRef = useRef(store)
    storeRef.current = store
    /** 等回复期间记住发出的会话，回复优先落回那里 */
    const pendingConv = useRef<string | null>(null)
    /** space.id → 会话 id：主动消息（定时苏醒）也按它归位 */
    const spaceMap = useRef(new Map<string, string>())
    const timeoutRef = useRef<number | null>(null)

    useEffect(() => {
        const unsub = window.desktop?.onMessage?.(appendFrame)
        return () => {
            unsub?.()
            disarmTimeout()
        }
        // 订阅只挂一次；会话数据一律经 storeRef 取最新
    }, [])

    /** 发出一条消息；段数组由数据缝构建，这里只装帧 */
    function send(convId: string, text: string): void {
        if (pending) return
        const segments = storeRef.current.sendOutgoing(convId, text)
        pendingConv.current = convId
        spaceMap.current.set(DESKTOP_USER_ID, convId)
        setPending(true)
        armTimeout()
        const frame: OutgoingMessageFrame = {
            type: 'message',
            messageId: crypto.randomUUID(),
            userId: DESKTOP_USER_ID,
            segments,
        }
        void window.desktop
            ?.sendMessage?.(frame)
            ?.then((ok) => {
                if (!ok) releasePending()
            })
            ?.catch(() => releasePending())
    }

    function releasePending(): void {
        pendingConv.current = null
        disarmTimeout()
        setPending(false)
    }

    function armTimeout(): void {
        disarmTimeout()
        timeoutRef.current = window.setTimeout(() => {
            timeoutRef.current = null
            pendingConv.current = null
            setPending(false)
        }, REPLY_TIMEOUT_MS)
    }

    function disarmTimeout(): void {
        if (timeoutRef.current) {
            window.clearTimeout(timeoutRef.current)
            timeoutRef.current = null
        }
    }

    /** 入站帧落会话：占位协议只发 text 段，未知类型静默丢弃 */
    function appendFrame(frame: IncomingMessageFrame): void {
        const segments = toRenderSegments(frame.segments)
        if (segments.length === 0) return
        const cur = storeRef.current
        const convId = pendingConv.current
            ?? spaceMap.current.get(frame.space.id)
            ?? cur.active?.id
            ?? cur.create()
        cur.appendMessage(convId, { id: nextId(), role: 'agent', time: nowTime(), segments })
        spaceMap.current.set(frame.space.id, convId)
        // 回复是按段拆帧连发的，第一帧即解锁输入，后续帧靠 spaceMap 归位
        if (pendingConv.current) releasePending()
    }

    function toRenderSegments(raw: IncomingMessageFrame['segments']): Segment[] {
        return raw.flatMap((seg): Segment[] => {
            if (seg.type !== 'text') return []
            const text = typeof seg.data?.text === 'string' ? seg.data.text : ''
            return text ? [{ type: 'text', data: { text } }] : []
        })
    }

    return { pending, send }
}
