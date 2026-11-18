import type { CoreConfig } from '../../shared/core-types.ts'

/** 本地核心配置表单的纯逻辑：分组定义、草稿加载与差量解析（无 JSX，可被 node 直接跑） */

/** 配置表单草稿：标量统一按字符串/布尔承载，保存时按字段类型解析回写 */
export type CoreDraft = {
    wsPort: string
    token: string
    desktopPort: string
    enableOnebot: boolean
    enableWechat: boolean
    wechatStorageDir: string
    webPort: string
    webPath: string
    webToken: string
    webLogBufferSize: string
    selfId: string
    owner: string
    members: string
    targetGroupId: string
    targetUserId: string
    llmApiUrl: string
    chatModel: string
    aiApiKey: string
    llmTimeout: string
    llmVisionApiUrl: string
    visionModel: string
    visionApiKey: string
    guardModel: string
    guardApiUrl: string
    guardApiKey: string
    enableProactiveChat: boolean
    proactiveChatLimit: string
    toolOutput: boolean
    toolTimeout: string
    toolChainMaxLength: string
    contextBudgetTokens: string
    chatSummaryThresholdTokens: string
    enableLongTermMemory: boolean
    memoryStorePath: string
    memoryEmbedProvider: string
    memoryOllamaUrl: string
    memoryEmbedBaseUrl: string
    memoryEmbedApiKey: string
    memoryEmbedModel: string
    memoryMinSimilarity: string
    memorySearchTopK: string
    memoryHalfLifeDays: string
    memoryTimeout: string
    memoryMaintainEveryWrites: string
    memoryMaxRecords: string
    memoryUserIdPrefix: string
    shellGate: string
    mcpServers: string
    githubToken: string
}

export type FieldSpec =
    | { kind: 'text' | 'secret' | 'number' | 'csv' | 'kv' | 'json'; key: keyof CoreDraft; label: string; hint?: string; placeholder?: string; showIf?: { key: keyof CoreDraft; equals: string }; wide?: boolean }
    | { kind: 'switch'; key: keyof CoreDraft; label: string; hint?: string; showIf?: { key: keyof CoreDraft; equals: string }; wide?: boolean }
    | { kind: 'option'; key: keyof CoreDraft; label: string; hint?: string; options: Array<{ value: string; label: string }>; showIf?: { key: keyof CoreDraft; equals: string }; wide?: boolean }

export type FieldGroup = { id: string; label: string; desc: string; fields: FieldSpec[] }

/** 数字字段的取值规则（缺省按 ≥0 的数字处理） */
const NUMBER_RULES: Partial<Record<keyof CoreDraft, { min?: number; max?: number; int?: boolean; port?: boolean }>> = {
    wsPort: { port: true },
    desktopPort: { port: true },
    webPort: { port: true },
    webLogBufferSize: { int: true, min: 0 },
    llmTimeout: { int: true, min: 0 },
    proactiveChatLimit: { int: true, min: 0 },
    toolTimeout: { int: true, min: 0 },
    toolChainMaxLength: { int: true, min: 1 },
    contextBudgetTokens: { int: true, min: 0 },
    chatSummaryThresholdTokens: { int: true, min: 0 },
    memoryMinSimilarity: { min: 0, max: 1 },
    memorySearchTopK: { int: true, min: 0 },
    memoryHalfLifeDays: { min: 0 },
    memoryTimeout: { int: true, min: 0 },
    memoryMaintainEveryWrites: { int: true, min: 0 },
    memoryMaxRecords: { int: true, min: 0 },
}

/** 配置分组：与 core config.js 的分区注释一致，覆盖全部键；接入按通道拆分 */
export const CFG_GROUPS: FieldGroup[] = [
    {
        id: 'onebot',
        label: 'OneBot',
        desc: 'QQ 接入：OneBot 反向 WebSocket 服务的开关、端口与鉴权。',
        fields: [
            { kind: 'switch', key: 'enableOnebot', label: '启用 OneBot 接入', hint: '反向 WS 地址填 ws://本机IP:<wsPort>/onebot/v11/ws' },
            { kind: 'number', key: 'wsPort', label: 'OneBot 端口 (wsPort)' },
            { kind: 'secret', key: 'token', label: '鉴权 Token (token)', hint: 'OneBot 与桌面客户端握手共用' },
        ],
    },
    {
        id: 'wechat',
        label: '微信',
        desc: '微信接入：登录凭证与存储位置。',
        fields: [
            { kind: 'switch', key: 'enableWechat', label: '启用微信接入', hint: '无凭证时会无限重试登录，不用建议关掉；首次登录在「运行」页扫码' },
            { kind: 'text', key: 'wechatStorageDir', label: '微信数据目录 (wechatStorageDir)', hint: '登录凭证落在这里', wide: true },
        ],
    },
    {
        id: 'desktop',
        label: '桌面',
        desc: '桌面客户端的 WebSocket 服务（鉴权与 OneBot 共用 token）。',
        fields: [
            { kind: 'number', key: 'desktopPort', label: '桌面端口 (desktopPort)' },
        ],
    },
    {
        id: 'panel',
        label: '面板',
        desc: 'Bot 侧的面板 API 服务（仅绑定 127.0.0.1）。',
        fields: [
            { kind: 'number', key: 'webPort', label: '面板端口 (web.port)' },
            { kind: 'text', key: 'webPath', label: '面板路径 (web.path)' },
            { kind: 'secret', key: 'webToken', label: '面板 Token (web.token)' },
            { kind: 'number', key: 'webLogBufferSize', label: '面板日志缓冲条数 (web.logBufferSize)' },
        ],
    },
    {
        id: 'identity',
        label: '身份',
        desc: '机器人身份、管理员与允许对话的白名单。',
        fields: [
            { kind: 'text', key: 'selfId', label: '机器人 QQ (selfId)' },
            { kind: 'csv', key: 'owner', label: '管理员 QQ (owner)', hint: '逗号分隔；可放行审批、直通 shell 门禁' },
            { kind: 'kv', key: 'members', label: '成员昵称表 (members)', hint: '每行一条「QQ号=昵称」，对话里用来显示发言人名字', wide: true },
            { kind: 'csv', key: 'targetGroupId', label: '群白名单 (targetGroupId)', hint: '逗号分隔；留空表示全部放行' },
            { kind: 'csv', key: 'targetUserId', label: '私聊白名单 (targetUserId)', hint: '逗号分隔；留空表示全部放行' },
        ],
    },
    {
        id: 'model',
        label: '模型',
        desc: '文本 / 视觉模型与 run_shell 审查模型。',
        fields: [
            { kind: 'text', key: 'llmApiUrl', label: '模型地址 (llmApiUrl)', placeholder: 'https://api.example.com/v1/chat/completions', wide: true },
            { kind: 'text', key: 'chatModel', label: '对话模型 (chatModel)' },
            { kind: 'secret', key: 'aiApiKey', label: 'API Key (aiApiKey)', placeholder: 'sk-…' },
            { kind: 'number', key: 'llmTimeout', label: '模型超时 (llmTimeout，毫秒)' },
            { kind: 'text', key: 'llmVisionApiUrl', label: '视觉模型地址 (llmVisionApiUrl)', hint: '留空沿用默认配置层的地址', wide: true },
            { kind: 'text', key: 'visionModel', label: '识图模型 (visionModel)' },
            { kind: 'secret', key: 'visionApiKey', label: '视觉 API Key (visionApiKey)' },
            { kind: 'text', key: 'guardModel', label: '审查模型 (guardModel)', hint: 'run_shell 安全审查用；留空表示未启用，需审查的调用逐条挂起' },
            { kind: 'text', key: 'guardApiUrl', label: '审查模型地址 (guardApiUrl)', hint: '留空用主模型地址', wide: true },
            { kind: 'secret', key: 'guardApiKey', label: '审查模型 Key (guardApiKey)', hint: '留空用主 API Key' },
        ],
    },
    {
        id: 'chat',
        label: '对话',
        desc: '主动聊天与 Agent 循环的行为参数。',
        fields: [
            { kind: 'switch', key: 'enableProactiveChat', label: '主动聊天' },
            { kind: 'number', key: 'proactiveChatLimit', label: '主动聊天阈值 (proactiveChatLimit)', hint: '无 @ 的消息累计多少条后唤醒' },
            { kind: 'switch', key: 'toolOutput', label: '播报工具调用 (toolOutput)' },
            { kind: 'number', key: 'toolTimeout', label: '工具超时 (toolTimeout，毫秒)', hint: '到点放弃等待并终止子进程；0 表示不限' },
            { kind: 'number', key: 'toolChainMaxLength', label: '工具链最大轮数 (toolChainMaxLength)' },
            { kind: 'number', key: 'contextBudgetTokens', label: '工作预算 (contextBudgetTokens)', hint: '超出时折叠最旧的工具调用痕迹' },
            { kind: 'number', key: 'chatSummaryThresholdTokens', label: '摘要阈值 (chatSummaryThresholdTokens)', hint: '一轮结束后仍超出则后台摘要压缩对话' },
        ],
    },
    {
        id: 'memory',
        label: '记忆',
        desc: '长期记忆（rememori）与 embedding 召回。',
        fields: [
            { kind: 'switch', key: 'enableLongTermMemory', label: '长期记忆' },
            { kind: 'text', key: 'memoryStorePath', label: '记忆文件路径 (memoryStorePath)', wide: true },
            { kind: 'option', key: 'memoryEmbedProvider', label: 'Embedding 提供方', hint: '切换提供方后已存向量全部失效，需删 .mem 重建', options: [{ value: 'ollama', label: 'Ollama' }, { value: 'openai', label: 'OpenAI 兼容' }] },
            { kind: 'text', key: 'memoryOllamaUrl', label: 'Ollama 地址 (memoryOllamaUrl)', showIf: { key: 'memoryEmbedProvider', equals: 'ollama' } },
            { kind: 'text', key: 'memoryEmbedBaseUrl', label: 'Embedding 接口地址 (memoryEmbedBaseUrl)', hint: '留空用 OpenAI 官方', showIf: { key: 'memoryEmbedProvider', equals: 'openai' } },
            { kind: 'secret', key: 'memoryEmbedApiKey', label: 'Embedding Key (memoryEmbedApiKey)', showIf: { key: 'memoryEmbedProvider', equals: 'openai' } },
            { kind: 'text', key: 'memoryEmbedModel', label: 'Embedding 模型 (memoryEmbedModel)', hint: '如 bge-m3' },
            { kind: 'number', key: 'memoryMinSimilarity', label: '召回相似度底线 (memoryMinSimilarity)', hint: '原始余弦相似度，换 embedding 模型后需重新实测' },
            { kind: 'number', key: 'memorySearchTopK', label: '最大召回数量 (memorySearchTopK)' },
            { kind: 'number', key: 'memoryHalfLifeDays', label: '时间衰减半衰期 (memoryHalfLifeDays，天)', hint: '0 表示不衰减' },
            { kind: 'number', key: 'memoryTimeout', label: '记忆操作超时 (memoryTimeout，毫秒)', hint: '避免 Ollama 无响应卡住对话' },
            { kind: 'number', key: 'memoryMaintainEveryWrites', label: '维护间隔 (memoryMaintainEveryWrites)', hint: '每成功写入多少条做一次维护；0 表示只在启动时' },
            { kind: 'number', key: 'memoryMaxRecords', label: '记忆条数上限 (memoryMaxRecords)', hint: '超出按重要度与时间淘汰；0 表示不限' },
            { kind: 'text', key: 'memoryUserIdPrefix', label: '命名空间前缀 (memoryUserIdPrefix)' },
        ],
    },
    {
        id: 'external',
        label: '外部',
        desc: '工具门禁与外部服务凭据。',
        fields: [
            { kind: 'option', key: 'shellGate', label: 'Shell 门禁 (shellGate)', hint: 'guard=所有人经审查模型审查；open=仅非管理员审查', options: [{ value: 'guard', label: 'guard' }, { value: 'open', label: 'open' }] },
            { kind: 'json', key: 'mcpServers', label: 'MCP 服务器 (mcpServers)', hint: 'JSON 数组，按 name 增量合并；写 {"name": "…", "disabled": true} 可剔除默认项。清空并保存=从 config.json 移除该键，恢复默认集', wide: true },
            { kind: 'secret', key: 'githubToken', label: 'GitHub Token (githubToken)', hint: 'skill-manager 安装技能、GitHub MCP 使用' },
        ],
    },
]

/** config.json → 表单草稿（缺失的键给 config.js 同款默认显示） */
export function loadCoreDraft(cfg: CoreConfig): CoreDraft {
    const web = (typeof cfg.web === 'object' && cfg.web !== null ? cfg.web : {}) as Record<string, unknown>
    const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : v == null ? fallback : String(v))
    const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
    const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
    const list = (v: unknown) => (Array.isArray(v) ? v.map(String).join(', ') : '')
    const lines = (v: unknown) => {
        if (typeof v !== 'object' || v === null || Array.isArray(v)) return ''
        return Object.entries(v as Record<string, unknown>).map(([id, name]) => `${id}=${String(name)}`).join('\n')
    }
    return {
        wsPort: String(num(cfg.wsPort, 8080)),
        token: str(cfg.token, ''),
        desktopPort: String(num(cfg.desktopPort, 2147)),
        enableOnebot: bool(cfg.enableOnebot, true),
        enableWechat: bool(cfg.enableWechat, true),
        wechatStorageDir: str(cfg.wechatStorageDir, '.wechatbot'),
        webPort: String(num(web.port, 2145)),
        webPath: str(web.path, '/api/v1/ws'),
        webToken: str(web.token, ''),
        webLogBufferSize: String(num(web.logBufferSize, 1000)),
        selfId: str(cfg.selfId, ''),
        owner: list(cfg.owner),
        members: lines(cfg.members),
        targetGroupId: list(cfg.targetGroupId),
        targetUserId: list(cfg.targetUserId),
        llmApiUrl: str(cfg.llmApiUrl, ''),
        chatModel: str(cfg.chatModel, ''),
        aiApiKey: str(cfg.aiApiKey, ''),
        llmTimeout: String(num(cfg.llmTimeout, 60000)),
        llmVisionApiUrl: str(cfg.llmVisionApiUrl, ''),
        visionModel: str(cfg.visionModel, ''),
        visionApiKey: str(cfg.visionApiKey, ''),
        guardModel: str(cfg.guardModel, ''),
        guardApiUrl: str(cfg.guardApiUrl, ''),
        guardApiKey: cfg.guardApiKey == null ? '' : String(cfg.guardApiKey),
        enableProactiveChat: bool(cfg.enableProactiveChat, true),
        proactiveChatLimit: String(num(cfg.proactiveChatLimit, 25)),
        toolOutput: bool(cfg.toolOutput, false),
        toolTimeout: String(num(cfg.toolTimeout, 180000)),
        toolChainMaxLength: String(num(cfg.toolChainMaxLength, 30)),
        contextBudgetTokens: String(num(cfg.contextBudgetTokens, 24000)),
        chatSummaryThresholdTokens: String(num(cfg.chatSummaryThresholdTokens, 12000)),
        enableLongTermMemory: bool(cfg.enableLongTermMemory, true),
        memoryStorePath: str(cfg.memoryStorePath, 'data/rememori/memory.mem'),
        memoryEmbedProvider: cfg.memoryEmbedProvider === 'openai' ? 'openai' : 'ollama',
        memoryOllamaUrl: str(cfg.memoryOllamaUrl, 'http://localhost:11434'),
        memoryEmbedBaseUrl: str(cfg.memoryEmbedBaseUrl, ''),
        memoryEmbedApiKey: cfg.memoryEmbedApiKey == null ? '' : String(cfg.memoryEmbedApiKey),
        memoryEmbedModel: str(cfg.memoryEmbedModel, 'bge-m3'),
        memoryMinSimilarity: String(num(cfg.memoryMinSimilarity, 0.5)),
        memorySearchTopK: String(num(cfg.memorySearchTopK, 10)),
        memoryHalfLifeDays: String(num(cfg.memoryHalfLifeDays, 15)),
        memoryTimeout: String(num(cfg.memoryTimeout, 15000)),
        memoryMaintainEveryWrites: String(num(cfg.memoryMaintainEveryWrites, 100)),
        memoryMaxRecords: String(num(cfg.memoryMaxRecords, 2000)),
        memoryUserIdPrefix: str(cfg.memoryUserIdPrefix, 'SunBot'),
        shellGate: cfg.shellGate === 'open' ? 'open' : 'guard',
        mcpServers: Array.isArray(cfg.mcpServers) ? JSON.stringify(cfg.mcpServers, null, 2) : '',
        githubToken: cfg.githubToken == null ? '' : String(cfg.githubToken),
    }
}

/**
 * 表单草稿 → config.json 补丁：只写相对加载时改过的键。
 * 播种模板只写少量键，其余全走 core 默认值层——全量回写会把默认值覆盖成空值
 * （白名单甚至会从默认拒绝翻成全放行），所以未改动的键保持 config.json 原样。
 */
export function toCorePatch(draft: CoreDraft, initial: CoreDraft | null): { patch: CoreConfig } | { error: string } {
    const errors: string[] = []
    const patch: CoreConfig = {}
    for (const group of CFG_GROUPS) {
        for (const field of group.fields) {
            const raw = String(draft[field.key] ?? '')
            if (initial != null && raw === String(initial[field.key] ?? '')) continue
            if (field.kind === 'switch') {
                patch[field.key] = Boolean(draft[field.key])
                continue
            }
            if (field.kind === 'option') {
                patch[field.key] = raw
                continue
            }
            if (field.kind === 'number') {
                const parsed = Number(raw.trim())
                const rule = NUMBER_RULES[field.key] ?? { min: 0 }
                if (!Number.isFinite(parsed)) errors.push(`「${field.label}」需要是数字`)
                else if (rule.port && (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535)) errors.push(`「${field.label}」需要是 1~65535 的整数`)
                else if (rule.int && !Number.isInteger(parsed)) errors.push(`「${field.label}」需要是整数`)
                else if (rule.min != null && parsed < rule.min) errors.push(`「${field.label}」不能小于 ${rule.min}`)
                else if (rule.max != null && parsed > rule.max) errors.push(`「${field.label}」不能大于 ${rule.max}`)
                else patch[field.key] = rule.int || rule.port ? Math.round(parsed) : parsed
                continue
            }
            if (field.kind === 'csv') {
                patch[field.key] = raw.trim() === '' ? [] : raw.split(/[,，\s]+/).filter(Boolean)
                continue
            }
            if (field.kind === 'kv') {
                const members: Record<string, string> = {}
                for (const line of raw.split('\n')) {
                    const text = line.trim()
                    if (text === '') continue
                    const eq = text.indexOf('=')
                    if (eq <= 0) {
                        errors.push(`「${field.label}」有格式不对的行：${text.slice(0, 40)}`)
                        continue
                    }
                    members[text.slice(0, eq).trim()] = text.slice(eq + 1).trim()
                }
                patch[field.key] = members
                continue
            }
            if (field.kind === 'json') {
                if (raw.trim() === '') continue
                try {
                    const parsed: unknown = JSON.parse(raw)
                    if (!Array.isArray(parsed)) throw new Error('需要是 JSON 数组')
                    patch[field.key] = parsed
                }
                catch (err) {
                    errors.push(`「${field.label}」不是合法 JSON：${err instanceof Error ? err.message : String(err)}`)
                }
                continue
            }
            patch[field.key] = raw.trim()
        }
    }
    if (errors.length > 0) return { error: errors.join('；') }
    return { patch }
}
