import { useEffect, useRef, useState } from 'react'
import { nextId, nowTime, type ConversationsStore } from './useConversations'
import type { MediaSegmentData, Segment } from './types'
import type { IncomingMessageFrame, OutgoingMessageFrame } from '../../preload/api.ts'

/** 桌面频道身份的缺省值（设置留空时回退） */
const DESKTOP_USER_ID = 'desktop'
/** 发出后等首帧回复的兜底窗口：超时只收掉思考指示，不阻塞输入 */
const REPLY_TIMEOUT_MS = 120_000
/** 同一条回复是按段拆帧连发的，两帧间隔 3~4s：通知节流窗口要能盖住整串 */
const NOTIFY_GAP_MS = 15_000

/**
 * 消息通道会话桥：出站帧由缝里构建的段数组直装，入站帧转成渲染段进会话。
 * 会话归属：后端把 conversationId 随帧回传，直接落回对应对话；
 * 没带（主动消息 / 旧后端）时回落到最近一次发送的对话，再回落到当前对话。
 * @param userId 桌面频道身份（设置页可配），随消息帧携带；留空回退 'desktop'
 */
export function useBackendChat(store: ConversationsStore, userId: string) {
    const [pending, setPending] = useState(false)
    const storeRef = useRef(store)
    storeRef.current = store
    const userIdRef = useRef(userId)
    userIdRef.current = userId
    /** 等回复期间记住发出的对话：中断与无归属帧都优先回到这里 */
    const pendingConv = useRef<string | null>(null)
    const timeoutRef = useRef<number | null>(null)
    /** 每个对话最近一帧的到达时间：一串连发的回复只喊一次，新回复隔开 15s 再喊 */
    const lastFrameAt = useRef<Map<string, number>>(new Map())

    useEffect(() => {
        const unsub = window.desktop?.onMessage?.(appendFrame)
        return () => {
            unsub?.()
            disarmTimeout()
        }
        // 订阅只挂一次；会话数据一律经 storeRef 取最新
    }, [])

    /** 发出一条消息；段数组由数据缝构建（extras 为附件段），这里只装帧 */
    function send(convId: string, text: string, extras: Segment[] = []): void {
        const frameUserId = userIdRef.current.trim() || DESKTOP_USER_ID
        const segments = storeRef.current.sendOutgoing(convId, text, extras)
        if (segments.length === 0) return
        pendingConv.current = convId
        setPending(true)
        armTimeout()
        const frame: OutgoingMessageFrame = {
            type: 'message',
            messageId: crypto.randomUUID(),
            userId: frameUserId,
            conversationId: convId,
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

    /**
     * 中断后端正在跑的那一轮：只发 abort 帧，不占会话消息、不进模型记忆。
     * 目标是正在等回复的那个对话（没在等时退回到当前对话）。
     * 被中断的轮次不会再投递回复，所以思考指示当场收掉，不等帧。
     */
    function stop(): void {
        const frameUserId = userIdRef.current.trim() || DESKTOP_USER_ID
        const conversationId = pendingConv.current ?? storeRef.current.active?.id
        void window.desktop?.abort?.({ userId: frameUserId, conversationId })?.catch(() => {})
        releasePending()
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
        const convId = resolveConversation(cur, frame)
        cur.appendMessage(convId, { id: nextId(), role: 'agent', time: nowTime(), segments })
        maybeNotify(convId, segments)
        // 回复是按段拆帧连发的，第一帧即收掉思考指示（pending 只管指示，不锁输入）
        if (pendingConv.current) releasePending()
    }

    /**
     * 系统通知：由主进程判断开关与窗口焦点，这里只负责「什么时候喊」。
     * 等的那个对话收到首帧就算回复到了；其余（主动消息）看与上一帧的间隔，
     * 一串连发的回复中间不会反复弹，等对话安静 15s 后新到的消息再喊。
     */
    function maybeNotify(convId: string, segments: Segment[]): void {
        const now = Date.now()
        const last = lastFrameAt.current.get(convId) ?? 0
        const first = pendingConv.current !== null
        lastFrameAt.current.set(convId, now)
        if (!first && now - last < NOTIFY_GAP_MS) return
        window.desktop?.notifyReply?.(previewOf(segments))
    }

    /** 帧归属：优先按后端回传的对话 id，退回到等的那个对话，再退回到当前对话 */
    function resolveConversation(cur: ConversationsStore, frame: IncomingMessageFrame): string {
        const target = frame.space.conversationId
        if (target && cur.conversations.some((c) => c.id === target)) return target
        return pendingConv.current ?? cur.active?.id ?? cur.create()
    }
    
    /** 通知正文：优先文本，纯媒体给个泛化描述 */
    function previewOf(segments: Segment[]): string {
        const text = segments
            .filter((seg) => seg.type === 'text')
            .map((seg) => seg.data.text ?? '')
            .join(' ')
            .trim()
        if (text !== '') return text
        return segments.some((seg) => seg.type === 'image') ? '[图片]' : '[文件]'
    }

    function toRenderSegments(raw: IncomingMessageFrame['segments']): Segment[] {
        return raw.flatMap((seg): Segment[] => {
            if (seg.type === 'text') {
                const text = typeof seg.data?.text === 'string' ? seg.data.text : ''
                return text ? [{ type: 'text', data: { text } }] : []
            }
            if (seg.type === 'image' || seg.type === 'file') {
                return seg.data && typeof seg.data === 'object'
                    ? [{ type: seg.type, data: seg.data as MediaSegmentData }]
                    : []
            }
            return []
        })
    }

    return { pending, send, stop }
}
