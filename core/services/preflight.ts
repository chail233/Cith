/**
 * 启动配置自检
 *
 */
import config from "../config.js";
import logger from "../utils/logger.js";
import type { ConfigWarning } from "../api/runtime-state.ts";
import { runtimeState } from "../api/runtime-state.ts";

const cfg = config as unknown as Record<string, unknown>;

/**
 * 判断配置值是否仍未填写：null / undefined / 空串 / 模板占位符（your_xxx）
 */
export function isPlaceholder(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value !== "string") return false;
    const text = value.trim();
    return text === "" || /^your_/i.test(text);
}

/** 判断白名单是否为空 */
function isEmptyList(value: unknown): boolean {
    if (!Array.isArray(value) || value.length === 0) return true;
    return value.every((item) => isPlaceholder(item));
}

/** 收集配置问题清单，纯函数便于后续复用到自检命令 */
export function collectConfigWarnings(): ConfigWarning[] {
    const warnings: ConfigWarning[] = [];

    const add = (level: ConfigWarning["level"], key: string, message: string, fix: string): void => {
        warnings.push({ level, key, message, fix });
    };

    // ===== 致命：不修复就完全收不到回复 =====
    if (isPlaceholder(cfg.owner)) {
        add(
            "error",
            "owner",
            "管理员（owner）未配置，所有管理指令（#bind、#do-yes、#ms 等）都会返回「无权限」",
            'core/configDev.js 或 core/config.js 中填写 owner: "你的QQ号"',
        );
    }

    if (isEmptyList(cfg.targetGroupId) && isEmptyList(cfg.targetUserId)) {
        add(
            "error",
            "targetGroupId",
            "会话白名单为空，机器人不会处理任何群 / 私聊消息",
            "管理员在目标会话里发送 #bind 绑定当前会话，或直接填写 targetGroupId / targetUserId",
        );
    }

    if (isPlaceholder(cfg.aiApiKey)) {
        add(
            "error",
            "aiApiKey",
            "文本模型 API Key 未配置，AI 无法生成回复",
            "填写 aiApiKey（与 llmApiUrl 指向的服务商对应）",
        );
    }

    if (isPlaceholder(cfg.llmApiUrl) || isPlaceholder(cfg.chatModel)) {
        add(
            "error",
            "chatModel",
            "llmApiUrl 或 chatModel 未填写，无法发起模型请求",
            "填写 OpenAI 兼容协议的接口地址与模型名称，如 https://api.openai.com/v1/chat/completions + gpt-4o-mini",
        );
    }

    // ===== 提示：功能降级，不影响核心对话 =====
    if (isPlaceholder(cfg.selfId)) {
        add(
            "warn",
            "selfId",
            "机器人自身 QQ 号未配置，@机器人 时无法识别为「我」，主动消息也可能发错目标",
            '填写 selfId: "机器人QQ号"',
        );
    }

    if (isPlaceholder(cfg.visionApiKey)) {
        add(
            "warn",
            "visionApiKey",
            "视觉 API Key 未配置，群内图片不会被识别（其余功能不受影响）",
            "需要识图能力时填写 visionApiKey 与 visionModel",
        );
    }

    if (isPlaceholder(cfg.token)) {
        add(
            "warn",
            "token",
            "NapCat HTTP 接口的 token 未配置，取图等 HTTP 请求将不带鉴权",
            'NapCat 若开启了 HTTP 鉴权，请填写 token: "NapCat 的 access token"',
        );
    }

    const webToken = (cfg.web as { token?: unknown } | undefined)?.token;
    if (typeof webToken === "string" && (webToken === "114514" || webToken.length < 8)) {
        add(
            "warn",
            "web.token",
            `面板 API token 仍是默认值或过短（${webToken}），存在被本机其他程序连接的风险`,
            "改为随机长字符串，并同步修改 web/.env 的 BOT_API_TOKEN",
        );
    }

    if (cfg.enableLongTermMemory === true) {
        const provider = String(cfg.memoryEmbedProvider ?? "ollama").trim().toLowerCase();
        if (provider === "openai") {
            if (isPlaceholder(cfg.memoryEmbedApiKey) || isPlaceholder(cfg.memoryEmbedModel)) {
                add(
                    "warn",
                    "memoryEmbedModel",
                    "已开启长期记忆（API embedding），但接口密钥或模型未配置，长期记忆将无法初始化",
                    "填写 memoryEmbedApiKey 与 memoryEmbedModel（如阿里云百炼 text-embedding-v4）；" +
                    "接口地址填 memoryEmbedBaseUrl（如 https://dashscope.aliyuncs.com/compatible-mode/v1），留空则为 OpenAI 官方",
                );
            }
        }
        else if (isPlaceholder(cfg.memoryOllamaUrl) || isPlaceholder(cfg.memoryEmbedModel)) {
            add(
                "warn",
                "memoryEmbedModel",
                "已开启长期记忆，但 Ollama 地址或 embedding 模型未配置，长期记忆将无法初始化",
                "填写 memoryOllamaUrl（默认 http://localhost:11434）与 memoryEmbedModel（如 bge-m3，需先 ollama pull）",
            );
        }
    }

    return warnings;
}

/** 启动时执行自检：结果写入 runtimeState（面板读取），并在控制台打印醒目清单 */
export function runPreflight(): ConfigWarning[] {
    const warnings = collectConfigWarnings();
    runtimeState.configWarnings = warnings;

    if (warnings.length === 0) {
        logger.info("配置自检通过");
        return warnings;
    }

    const line = "=".repeat(66);
    const blocks = warnings.map((w, i) => {
        const tag = w.level === "error" ? "致命" : "提示";
        return `  ${i + 1}. [${tag}] ${w.message}\n     修复：${w.fix}`;
    });
    const hasFatal = warnings.some((w) => w.level === "error");
    const footer = hasFatal
        ? "  ↑ 标注「致命」的项不修复，机器人将无法正常回复消息。"
        : "  ↑ 以上均为提示项，核心对话功能可用。";

    logger.warn(`\n${line}\n配置自检发现 ${warnings.length} 项问题：\n${blocks.join("\n")}\n${footer}\n${line}\n`);
    return warnings;
}
