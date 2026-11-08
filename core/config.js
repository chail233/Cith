/**
 * 统一配置模块
 *
 * config.json 只写需要覆盖默认值的键；开发与生产共用同一套机制，无需切换任何开关。
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 用户配置层路径：默认与 config.js 同目录，可用 CITH_CONFIG 指向仓库外 */
const userConfigPath = process.env.CITH_CONFIG
    ? resolve(process.env.CITH_CONFIG)
    : join(__dirname, "config.json");

/** mcpServers 里 command 的占位符：JSON 无法表达 process.execPath */
const NODE_PLACEHOLDER = "$NODE";

/** 不参与自动持久化的键：Map 结构 / 含机器相关占位符，落盘会把本地值写死 */
const NO_PERSIST_KEYS = new Set(["members", "mcpServers"]);

/** 密钥类：可持久化但需重启才生效，落盘时提示 */
const RESTART_KEYS = new Set([
    "aiApiKey", "visionApiKey", "githubToken", "token", "memoryEmbedApiKey",
]);

/**
 * 旧键 → 新键映射（历史配置兼容）
 * 新键已显式填写时以新键为准，旧键被丢弃
 */
const LEGACY_KEY_MAP = {
    aiAPIKEY: "aiApiKey",
    visionAPIKEY: "visionApiKey",
    EnableProactiveChat: "enableProactiveChat",
    PROACTIVE_CHAT_LIMIT: "proactiveChatLimit",
    LLM_API_URL: "llmApiUrl",
    LLM_VISION_API_URL: "llmVisionApiUrl",
    CHAT_MODEL: "chatModel",
    VISION_MODEL: "visionModel",
    LLM_TIMEOUT: "llmTimeout",
    ENABLE_LONG_TERM_MEMORY: "enableLongTermMemory",
    MEMORY_STORE_PATH: "memoryStorePath",
    MEMORY_OLLAMA_URL: "memoryOllamaUrl",
    MEMORY_EMBED_MODEL: "memoryEmbedModel",
    MEMORY_EMBED_PROVIDER: "memoryEmbedProvider",
    MEMORY_EMBED_BASE_URL: "memoryEmbedBaseUrl",
    MEMORY_EMBED_API_KEY: "memoryEmbedApiKey",
    MEMORY_SEARCH_TOP_K: "memorySearchTopK",
    MEMORY_MIN_SIMILARITY: "memoryMinSimilarity",
    MEMORY_HALF_LIFE_DAYS: "memoryHalfLifeDays",
    MEMORY_TIMEOUT: "memoryTimeout",
    MEMORY_MAINTAIN_EVERY_WRITES: "memoryMaintainEveryWrites",
    TOOLCHAIN_MAX_LENGTH: "toolChainMaxLength",
    MEMORY_USER_ID_PREFIX: "memoryUserIdPrefix",
};

const baseConfig = {
    // ========== 服务与接入 ==========

    /** OneBot 反向 WebSocket 服务端口 */
    wsPort: 8080,

    wechatStorageDir: ".wechatbot",

    /**
     * NapCat 鉴权 token
     */
    token: "your_token_here",

    /** NapCat HTTP API 地址（不含协议前缀） */
    napcatHttpHost: "127.0.0.1:3000",

    /** 面板 API 服务（Bot 侧，仅绑定 127.0.0.1） */
    web: {
        port: 2145,
        path: "/api/v1/ws",
        token: "114514",
        logBufferSize: 1000,
    },

    // ========== 会话白名单 ==========

    /** 目标群 ID */
    targetGroupId: ["your_group_id"],

    /** 目标用户 ID（私聊） */
    targetUserId: ["your_user_id"],

    // ========== 身份 ==========

    /** 机器人自身 QQ 号 */
    selfId: "your_bot_qq",

    /** 主人（管理员）QQ 号 */
    owner: "your_owner_qq",

    /**
     * QQ 号 → 群昵称 映射表
     * 用于在 AI 对话上下文中显示发言人名称
     */
    members: new Map([]),

    // ========== 模型 ==========

    /** 文本模型 API 地址（OpenAI 兼容协议） */
    llmApiUrl: "https://workspace.aliyuncs.com/v1/chat/completions",

    /** 视觉模型 API 地址 */
    llmVisionApiUrl: "https://workspace.aliyuncs.com/v1/chat/completions",

    /** 文本模型 API Key */
    aiApiKey: "your_ai_api_key",

    /** 视觉模型 API Key */
    visionApiKey: "your_vision_api_key",

    /** 聊天模型名称 */
    chatModel: "deepseek-v4.1-flash-1017",

    /** 识图模型名称 */
    visionModel: "deepseek-v4.1-flash-1017",

    /** 模型接口超时（毫秒） */
    llmTimeout: 60000,

    // ========== 对话行为 ==========

    /** 主动聊天触发阈值：无 @ 的消息累计多少条后唤醒 */
    proactiveChatLimit: 25,

    /** 主动聊天开关 */
    enableProactiveChat: true,

    /** 是否在播报工具调用 */
    toolOutput: false,

    /** Agent 工具链最大轮数 */
    toolChainMaxLength: 30,

    /** 工作阈值（token）：Agent 循环内上下文超出时折叠最旧的工具调用痕迹，降至一半以下 */
    contextBudgetTokens: 24000,

    /** 聊天阈值（token）：一轮 Agent 结束后上下文仍超出则后台摘要，压缩较旧的对话 */
    chatSummaryThresholdTokens: 12000,

    // ========== 长期记忆（rememori） ==========

    /** 长期记忆开关 */
    enableLongTermMemory: true,

    /** 记忆文件路径 */
    memoryStorePath: "data/rememori/memory.mem",

    /**
     * embedding 提供方：
     * - "ollama"：本地 Ollama（memoryOllamaUrl + memoryEmbedModel）
     * - "openai"：任意 OpenAI 兼容 /embeddings 接口（memoryEmbedBaseUrl + memoryEmbedApiKey + memoryEmbedModel）
     */
    memoryEmbedProvider: "ollama",

    /** Ollama 服务地址（memoryEmbedProvider 为 "ollama" 时生效） */
    memoryOllamaUrl: "http://localhost:11434",

    /** OpenAI 兼容接口地址（memoryEmbedProvider 为 "openai" 时生效），留空则用 OpenAI 官方 */
    memoryEmbedBaseUrl: "",

    /** OpenAI 兼容接口密钥（memoryEmbedProvider 为 "openai" 时必填） */
    memoryEmbedApiKey: null,

    /** embedding 模型名（ollama 如 bge-m3 */
    memoryEmbedModel: "bge-m3",

    /** 召回：原始余弦相似度底线（换 embedding 模型后需重新实测） */
    memoryMinSimilarity: 0.5,

    /** 召回：最大召回数量 */
    memorySearchTopK: 10,

    /** 召回：时间衰减半衰期（天），0 表示不衰减 */
    memoryHalfLifeDays: 15,

    /** 记忆操作超时（毫秒），避免 Ollama 无响应卡住对话 */
    memoryTimeout: 15000,

    /** 每成功写入多少条记忆执行一次维护（prune + 容量淘汰 + compact），0 表示只在启动时维护 */
    memoryMaintainEveryWrites: 100,

    /** 记忆条数上限：超出部分按 importance 升序、创建时间升序淘汰，0 表示不限 */
    memoryMaxRecords: 2000,

    /** 长期记忆命名空间前缀（后接会话 ID） */
    memoryUserIdPrefix: "SunBot",

    // ========== 工具与安全白名单（相对 core/） ==========

    /** 文件读取白名单目录 */
    readFileDirs: ["skills", "workspace"],

    /** JS 脚本执行白名单目录 */
    runJsDirs: ["skills", "workspace"],

    /** 文件编辑白名单目录 */
    editFileDirs: ["skills", "workspace"],

    // ========== 外部服务 ==========

    /**
     * MCP Server 配置列表
     *
     */
    mcpServers: [
        {
            name: "websearch",
            description: "联网搜索：search 可传 engines 指定引擎（bing=技术类精准，baidu=中文相关，sogou=中文最全但易限流）；另含 fetchWebContent 抓取网页正文",
            transport: "stdio",
            command: NODE_PLACEHOLDER,
            args: ["node_modules/open-websearch/build/index.js"],
            env: {
                MODE: "stdio",
                PORT: "3030",
                DEFAULT_SEARCH_ENGINE: "baidu",
                ALLOWED_SEARCH_ENGINES: "bing,baidu,sogou",
                OPEN_WEBSEARCH_QUIET_STARTUP: "true",
            },
        },
    ],

    /** GitHub API Token（skill-manager 安装技能、GitHub MCP 使用） */
    githubToken: null,
};

/**
 * 把旧键名就地替换为新键名
 * @param {Record<string, unknown>} target 待归一化的配置对象（会被修改）
 * @returns {string[]} 命中的「旧键 → 新键」描述，用于提示用户
 */
function normalizeLegacyKeys(target) {
    const renamed = [];
    for (const [legacyKey, newKey] of Object.entries(LEGACY_KEY_MAP)) {
        if (!Object.prototype.hasOwnProperty.call(target, legacyKey)) continue;
        // 新键已显式配置时以新键为准，避免旧键覆盖用户的新写法
        if (!Object.prototype.hasOwnProperty.call(target, newKey)) {
            target[newKey] = target[legacyKey];
        }
        delete target[legacyKey];
        renamed.push(`${legacyKey} → ${newKey}`);
    }
    return renamed;
}

/** 普通对象判断（排除 Map 等内置类型）：决定是否做一层合并 */
function isPlainObject(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/** JSON 不支持注记：约定以 $ 或 _ 开头的键只作说明，不进入配置 */
function isCommentKey(key) {
    return key.startsWith("$") || key.startsWith("_");
}

/** members 在 config.json 里是普通对象，运行期需要 Map */
function toMemberMap(raw) {
    if (!isPlainObject(raw)) return new Map();
    return new Map(
        Object.entries(raw)
            .filter(([id]) => !isCommentKey(id))
            .map(([id, name]) => [id, typeof name === "string" ? name : String(name)]),
    );
}

/** mcpServers.command 写 $NODE 时换成本进程 node，避免在 JSON 里写死绝对路径 */
function resolveMcpServer(server) {
    if (!isPlainObject(server) || server.command !== NODE_PLACEHOLDER) return server;
    return { ...server, command: process.execPath };
}

/** 默认配置里的 MCP 项与 config.json 共用同一套占位符，在合并用户配置前先行还原 */
baseConfig.mcpServers = baseConfig.mcpServers.map(resolveMcpServer);

/** JSON 表达不了的结构（Map）在此还原 */
function normalizeValue(key, value) {
    if (key === "members") return toMemberMap(value);
    return value;
}

/**
 * mcpServers 增量合并
 */
function mergeMcpServers(userList, baseList) {
    if (!Array.isArray(userList)) return baseList;

    const merged = [];
    const seen = new Set();
    for (const item of userList) {
        if (!isPlainObject(item) || typeof item.name !== "string" || item.name === "") {
            console.warn("[config] 已忽略缺少 name 的 mcpServers 项");
            continue;
        }
        if (seen.has(item.name)) {
            console.warn(`[config] mcpServers 名称重复，已忽略后一项：${item.name}`);
            continue;
        }
        seen.add(item.name);
        const server = resolveMcpServer(item);
        if (server.disabled !== true) merged.push(server);
    }
    for (const base of baseList) {
        if (!seen.has(base.name)) merged.push(base);
    }
    return merged;
}

/**
 * 把用户配置叠加到默认值；
 * 两边都是普通对象时合并一层
 */
function mergeUserConfig(target, source) {
    for (const [key, raw] of Object.entries(source)) {
        if (isCommentKey(key)) continue;
        if (key === "mcpServers") {
            target.mcpServers = mergeMcpServers(raw, target.mcpServers ?? []);
            continue;
        }
        const value = normalizeValue(key, raw);
        target[key] = isPlainObject(target[key]) && isPlainObject(value)
            ? { ...target[key], ...value }
            : value;
    }
}

/** 读取用户配置；文件损坏时抛错，由调用方决定是退出还是拒绝落盘 */
function readUserConfigFile() {
    const text = readFileSync(userConfigPath, "utf8").replace(/^\uFEFF/, "");
    let data;
    try {
        data = JSON.parse(text);
    }
    catch (e) {
        throw new Error(`JSON 解析失败：${e.message}`);
    }
    if (!isPlainObject(data)) throw new Error("顶层必须是 JSON 对象");
    return data;
}

/** 原子写：先写 tmp 再 rename，避免崩溃瞬间留下半截文件 */
function writeUserConfigFile(data) {
    const tmp = `${userConfigPath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    renameSync(tmp, userConfigPath);
}

if (existsSync(userConfigPath)) {
    let userConfig;
    try {
        userConfig = readUserConfigFile();
    }
    catch (e) {
        // 静默忽略会让程序带着占位符密钥启动，比启动失败更危险
        console.error(`
[config] 用户配置无法解析：${userConfigPath}
  ${e.message}

  这是配置的唯一来源，已中止启动以免带着默认值运行。
  修复：检查 JSON 语法（不能有尾逗号；说明文字请写成以 $ 或 _ 开头的键）
`);
        process.exit(1);
    }

    const renamed = normalizeLegacyKeys(userConfig);
    if (renamed.length > 0) {
        writeUserConfigFile(userConfig);
        console.warn(`[config] config.json 中的旧键名已自动迁移：\n  ${renamed.join("\n  ")}`);
    }

    mergeUserConfig(baseConfig, userConfig);
}
else {
    console.warn(`[config] 未找到用户配置：${userConfigPath}（全部使用默认值，可用 npm run setup 生成）`);
}

/**
 * 运行期热改落盘（#ms 切模型、面板 set_config 等）：
 * 读-改-写整个文件，保留用户手写的其他键
 */
function persistKey(key, value) {
    let snapshot;
    try {
        snapshot = readUserConfigFile();
    }
    catch (e) {
        console.error(`[config] ${key} 仅本次运行生效：${userConfigPath} 无法解析（${e.message}），拒绝覆盖以免丢配置`);
        return;
    }
    snapshot[key] = value;
    writeUserConfigFile(snapshot);
}

// 用 Proxy 包裹导出：只定义 set，读自动透传到 target。
// 所有对 config 顶层键的赋值都会自动落盘，调用点无需任何改动。
const config = new Proxy(baseConfig, {
    set(target, key, value) {
        target[key] = value; // 内存立即生效

        if (typeof key !== "string" || NO_PERSIST_KEYS.has(key)) {
            return true; // 这些键只改内存，不落盘
        }

        try {
            JSON.stringify(value); // 序列化前校验，坏值不落盘
        }
        catch (e) {
            console.error(`[config] ${key} 无法序列化，已忽略持久化:`, e.message);
            return true;
        }

        if (RESTART_KEYS.has(key)) {
            console.warn(`[config] ${key} 已持久化`);
        }

        persistKey(key, value);
        return true;
    },
});

export default config;
