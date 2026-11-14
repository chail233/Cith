export type TraceStatus = 'ok' | 'error' | 'running'

export type ToolTrace = {
    kind: 'trace'
    name: string
    summary: string
    status: TraceStatus
    durationMs?: number
    command?: string
    output?: string
}

export type Segment = { kind: 'text'; text: string } | ToolTrace

export type ChatMessage = {
    id: string
    role: 'user' | 'agent'
    time: string
    segments: Segment[]
}

export type Conversation = {
    id: string
    title: string
    updated: string
    messages: ChatMessage[]
}

export const initialConversations: Conversation[] = [
    {
        id: 'c1',
        title: '构建日志排查',
        updated: '刚刚',
        messages: [
            {
                id: 'm1',
                role: 'user',
                time: '14:02',
                segments: [{ kind: 'text', text: 'npm run build 报错了，帮我看看是哪的问题' }],
            },
            {
                id: 'm2',
                role: 'agent',
                time: '14:02',
                segments: [
                    {
                        kind: 'trace',
                        name: 'run_shell',
                        summary: '重跑构建看完整输出',
                        status: 'ok',
                        durationMs: 3412,
                        command: 'npm run build',
                        output: `> tsc -b && electron-vite build

src/preload/api.ts:5:7 - error TS2322:
  Type '() => Promise<number>' is not assignable to
  type '() => Promise<string>'.

  5    getVersion: (): Promise<number> => ipcRenderer.invoke('app:get-version')
                                            ~~~~~~~~

Found 1 error.`,
                    },
                    {
                        kind: 'text',
                        text: '找到了：`api.ts` 里 `getVersion` 被标成了 `Promise<number>`，和主进程 `app.getVersion()` 的返回类型对不上。\n\n改回 `Promise<string>` 后重新构建通过。要不要顺手把 `typecheck` 也挂进 build 脚本？',
                    },
                ],
            },
        ],
    },
    {
        id: 'c2',
        title: '睡前闲聊',
        updated: '昨天',
        messages: [
            {
                id: 'm1',
                role: 'user',
                time: '23:41',
                segments: [{ kind: 'text', text: '今天有点累，随便聊点什么吧' }],
            },
            {
                id: 'm2',
                role: 'agent',
                time: '23:41',
                segments: [
                    {
                        kind: 'text',
                        text: '那就聊点轻的。今天我把表情包 manifest 又补了三十张，`add-stickers` 跑完发现有两张描述重了，你明天看一眼要不要合并。……不过先说好，聊天可以，别又聊到一半睡着，上次你那句「等我看完这一章」之后就没有然后了。',
                    },
                ],
            },
        ],
    },
    {
        id: 'c3',
        title: '桌面客户端设计',
        updated: '周三',
        messages: [
            {
                id: 'm1',
                role: 'user',
                time: '10:17',
                segments: [{ kind: 'text', text: '桌面端侧栏放哪些东西比较合理？' }],
            },
            {
                id: 'm2',
                role: 'agent',
                time: '10:18',
                segments: [
                    {
                        kind: 'trace',
                        name: 'run_shell',
                        summary: '看一眼渲染层现有结构',
                        status: 'ok',
                        durationMs: 860,
                        command: 'ls desktop/src/renderer/src',
                        output: `App.css
App.tsx
main.tsx
vite-env.d.ts`,
                    },
                    {
                        kind: 'text',
                        text: '现在的骨架是 `main / preload / renderer` 三段，还只有一个占位界面。我倾向侧栏只留会话列表和设置；桌面端只承接桌面这一条频道的会话，不做跨平台收件箱——QQ 和微信的会话归各自平台，这里不掺和。',
                    },
                ],
            },
        ],
    },
]
