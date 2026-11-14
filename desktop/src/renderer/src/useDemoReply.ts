import { useEffect, useRef, useState } from 'react'
import { nextId, nowTime, type ConversationsStore } from './useConversations'
import type { ChatMessage } from './types'

const TRACE_DELAY = 900
const TRACE_DONE_DELAY = 2300
const REPLY_DELAY = 3100

const DEMO_REPLY =
    '这是演示模式的回复——后端协议接通后，这里会是真实的模型输出与工具调用。消息、工具痕迹、输入区的节奏感觉如何？'

/**
 * 演示用回复节奏：思考 → 工具痕迹（运行中→完成）→ 文字回复。
 * 纯前端编排，协议接通后整体删除，由真实链路替代。
 */
export function useDemoReply() {
    const [pending, setPending] = useState(false)
    const timers = useRef<number[]>([])

    useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), [])

    function start(convId: string, store: ConversationsStore) {
        setPending(true)

        timers.current.push(window.setTimeout(() => {
            store.appendMessage(convId, agentMessage([
                { kind: 'trace', name: 'run_shell', summary: 'tail -n 30 构建日志', status: 'running' },
            ]))
        }, TRACE_DELAY))

        timers.current.push(window.setTimeout(() => {
            store.updateLastTrace(convId, {
                status: 'ok',
                durationMs: 1240,
                command: 'npm run build',
                output: '> tsc -b && electron-vite build\n\n✓ built in 71ms',
            })
        }, TRACE_DONE_DELAY))

        timers.current.push(window.setTimeout(() => {
            store.appendMessage(convId, agentMessage([{ kind: 'text', text: DEMO_REPLY }]))
            setPending(false)
        }, REPLY_DELAY))
    }

    return { pending, start }
}

function agentMessage(segments: ChatMessage['segments']): ChatMessage {
    return { id: nextId(), role: 'agent', time: nowTime(), segments }
}
