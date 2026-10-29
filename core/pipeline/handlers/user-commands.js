import { getAgent, listAgents } from "../../agent/AgentManager.ts";
import config from "../../config.js";
import {skills, forceSkills} from "../../agent/skill.js";
import {mcpClient} from "../../agent/mcp-manager.js";
import {getAllTools} from "../../agent/tools.js";
import {cancel as doCancel, list as doList} from "../../agent/tool-approval.js";
import {confirmPending} from "../../agent/approval-runner.ts";
import { runAgent } from "../agent-runner.ts";
import { isPlaceholder } from "../../services/preflight.ts";
import logger from "../../utils/logger.js";

const cfg = /** @type {Record<string, any>} */ (config);

const BOOTSTRAP_COMMANDS = new Set(["bind"]);

/**
 * 是否为「未授权会话也要交给管道处理」的管理员引导指令
 * @param {string} text 原始消息文本
 * @returns {boolean}
 */
export function isBootstrapCommand(text) {
    if (typeof text !== "string") return false;
    const match = /^#\s*(\S+)/.exec(text.trim());
    return match !== null && BOOTSTRAP_COMMANDS.has(match[1]);
}

/**
 * 解析当前会话对应的白名单键
 * @param {import("../../types/index.ts").Context} ctx
 */
function bindTargetOf(ctx) {
    const isGroup = ctx.space.from === "group";
    return {
        key: isGroup ? "targetGroupId" : "targetUserId",
        label: isGroup ? "群" : "用户",
        id: String(ctx.space.id),
    };
}

const cmds = [
    {
        name: "clear",
        needsAdmin: true,
        description: "清除短期记忆（管理员）",
        params: [],
        handler: async (args, ctx) => {
            const recorder = getAgent(ctx.space).memory;
            const cnt = recorder.length;
            recorder.clear();
            return `清除了${cnt}条消息（会话 ${recorder.sessionId}）。`;
        }
    },
    {
        name: "help",
        description: "显示指令列表",
        params: [],
        handler: async (args, ctx) => {
            return cmds
                .filter(cmd => ctx.isAdmin || !cmd.needsAdmin)
                .map(cmd => `#${cmd.name} ${cmd.params.map(p => `<${p.name}:${p.desc}>`).join(" ")} //${cmd.description}`)
                .join('\n');
        }
    },
    {
        name: "bind",
        needsAdmin: true,
        description: "把当前会话加入白名单（管理员；未授权会话也可用）",
        params: [],
        handler: async (args, ctx) => {
            const target = bindTargetOf(ctx);
            const list = /** @type {string[]} */ (cfg[target.key] ?? []);
            if (list.includes(target.id)) {
                return `当前${target.label} ${target.id} 已在白名单中，无需重复绑定`;
            }
            // 整体赋值而非 push：config 的 Proxy 只在顶层赋值时落盘
            cfg[target.key] = [...list.filter(v => !isPlaceholder(v)), target.id];
            return `已将${target.label} ${target.id} 加入白名单，下一条消息起生效`;
        }
    },
    {
        name: "unbind",
        needsAdmin: true,
        description: "把当前会话移出白名单（管理员）",
        params: [],
        handler: async (args, ctx) => {
            const target = bindTargetOf(ctx);
            const list = /** @type {string[]} */ (cfg[target.key] ?? []);
            if (!list.includes(target.id)) {
                return `当前${target.label} ${target.id} 不在白名单中`;
            }
            cfg[target.key] = list.filter(v => v !== target.id);
            return `已将${target.label} ${target.id} 移出白名单，之后该会话的消息不再处理`;
        }
    },
    {
        name: "bindlist",
        needsAdmin: true,
        description: "查看会话白名单（管理员）",
        params: [],
        handler: async (args, ctx) => {
            const render = (key, label) => {
                const list = Array.isArray(cfg[key]) ? cfg[key] : [];
                const body = list.length === 0
                    ? "（空）"
                    : list.map((v) => (isPlaceholder(v) ? `${v}（占位符，未生效）` : String(v))).join("\n  ");
                return `${label}：\n  ${body}`;
            };
            return `${render("targetGroupId", "群白名单")}\n${render("targetUserId", "用户白名单")}`;
        }
    },
    {
        name: "msgs",
        needsAdmin: true,
        description: "列出短期记录",
        params: [],
        handler: async (args, ctx) => {
            const all = getAgent(ctx.space).memory.getAll();
            if (all.length === 0) return "短期记录为空";
            const lines = all.map((m, i) => {
                return `[${i + 1}] ${m.role}: ${m.content}`;
            });
            return `短期记录共 ${all.length} 条：\n${lines.join("\n")}`;
        }
    },
    {
        name: "cmsgs",
        needsAdmin: true,
        description: "列出缓存记录",
        params: [],
        handler: async (args, ctx)=>{
            const all = getAgent(ctx.space).memory.getCache();
            if (all.length === 0) return "缓存记录为空";
            const lines = all.map((m, i) => {
                return `[${i + 1}] ${m.role}: ${m.content}`;
            });
            return `缓存记录共 ${all.length} 条：\n${lines.join("\n")}`;
        }
    },
    {
        name: "sm",
        needsAdmin: true,
        description: "显示中期记忆概括",
        params: [],
        handler: async (args, ctx) => {
            const summary = getAgent(ctx.space).memory.getMidSummary();
            if (!summary) return "中期记忆为空";
            return `中期记忆（${summary.length} 字）：\n${summary}`;
        }
    },
    {
        name: "pchat",
        needsAdmin: true,
        description: "开启/关闭主动回复",
        params: [{ name: "开关", desc: "true/false" }],
        handler: async (args, ctx) => {
            if (args.length === 0) return "缺少参数 true/false";
            if (args[0] === "true") {
                config.EnableProactiveChat = true;
                return "开启了主动回复";
            }
            else {
                config.EnableProactiveChat = false;
                return "关闭了主动回复";
            }
        }
    },
    {
        name: "ms",
        needsAdmin: true,
        description: "设置文本模型（管理员）",
        params: [{ name: "模型名称", desc: "模型ID" }],
        handler: async (args, ctx) => {
            if (args.length === 0) return "缺少参数";
            config.CHAT_MODEL = args[0];
            return `切换了模型为 ${args[0]}`;
        }
    },
    {
        name: "skills",
        description: "列出技能列表",
        params: [],
        handler: async (args, ctx) => {
            return "技能列表：\n" + skills.map(skill => skill.name).join("\n");
        }
    },
    {
        name: "forceskills",
        description: "列出当前强加载技能",
        params: [],
        handler: async (args, ctx) => {
            if (forceSkills.length === 0) return "当前没有强加载技能";
            return "强加载技能：\n" + forceSkills.map(s => `${s.name} —— ${s.description}`).join("\n");
        }
    },
    {
        name: "compress",
        needsAdmin: true,
        description: "压缩短期记忆（管理员）",
        params: [],
        handler: async (args, ctx) => {
            try {
                await getAgent(ctx.space).memory.compress();
                return "压缩完成";
            }
            catch (err) {
                logger.error("短期记忆压缩失败:", err);
                return "压缩失败";
            }

        }
    },
    {
        name: "sessions",
        needsAdmin: true,
        description: "列出活跃会话（管理员）",
        params: [],
        handler: async (args, ctx) => {
            const list = listAgents();
            if (list.length === 0) return "当前没有活跃会话";
            const lines = list.map(s =>
                `${s.id}：短期 ${s.short} 条，缓存 ${s.cache} 条，${s.hasSummary ? "有概要" : "无概要"}，空闲 ${s.idleMin} 分钟`
            );
            return `活跃会话（${list.length} 个）：\n${lines.join("\n")}`;
        }
    },
    {
        name: "plan",
        description: "查看当前任务计划",
        params: [],
        handler: async (args, ctx) => {
            const text = getAgent(ctx.space).renderPlan();
            if (!text) return "当前没有任务计划";
            return `任务计划：\n${text}`;
        }
    },
    {
        name:"mcp",
        description: "列出MCP配置",
        params: [],
        handler: async (args, ctx) => {
            const result = [...mcpClient.connections.keys()];
            return `MCP列表：\n${result.join("\n")}`;
        }
    },
    {
        name:"tools",
        description: "工具列表",
        params: [],
        handler:async (args, ctx) => {
            return "工具列表：\n" + (await getAllTools()).map(tool => tool.function.name).join("\n");
        }
    },
    {
        name: "do-yes",
        needsAdmin: true,
        description: "确认执行待确认的危险操作（管理员）",
        params: [{ name: "id", desc: "待确认操作编号" }],
        handler: async (args, ctx) => {
            if (!args[0]) return "用法：#do-yes <id>";
            const result = await confirmPending(args[0], ctx);
            if (!result.ok) return result.text;
            runAgent(ctx).catch(err => {
                logger.error("AI 回复失败:", err);
            });
            return null;
        }
    },
    {
        name: "do-no",
        needsAdmin: true,
        description: "取消待确认的危险操作（管理员）",
        params: [{ name: "id", desc: "待确认操作编号" }],
        handler: async (args, ctx) => {
            if (!args[0]) return "用法：#do-no <id>";
            return doCancel(args[0]);
        }
    },
    {
        name: "do-pending",
        needsAdmin: true,
        description: "列出待确认的危险操作",
        params: [],
        handler: async (args, ctx) => {
            return doList();
        }
    },
    {
        name:"toolout",
        needsAdmin: true,
        description: "设置工具输出",
        params: [{name:"value", desc:"bool"}],
        handler: async (args, ctx) => {
            config.toolOutput = args[0] === "true";
            return "设置工具输出为" + config.toolOutput;
        }
    }
];

const USER_CMD_MAP = new Map(cmds.map(cmd => [cmd.name, cmd]));


/**
 * 解析用户命令
 * @param {string} rawText
 * @returns {{cmd: string|null, args: string[]}}
 */
function parseCommand(rawText) {
    const text = rawText.trim();
    if (!text.startsWith("#")) {
        return { cmd: null, args: [] };
    }
    const parts = text.slice(1).split(/\s+/);
    return { cmd: parts[0], args: parts.slice(1) };
}

/**
 * @param {object} ctx
 * @returns {Promise<boolean>}
 */
export default async function userCommands(ctx) {
    // trim 后再判断：群内「@机器人 #命令」时，@ 段被丢弃后会留下前导空格
    if (!ctx.text.trim().startsWith("#")) return false;

    const { cmd, args } = parseCommand(ctx.text);
    if (!cmd) {
        ctx.adapter.sendMsg(ctx.space, "指令格式无效");
        return true;
    }

    const command = USER_CMD_MAP.get(cmd);
    if (!command) return false;

    if (command.needsAdmin && !ctx.isAdmin) {
        // owner 未配置时所有人都会被拒，这里直接点明原因，避免用户以为是权限 bug
        const hint = isPlaceholder(config.owner)
            ? "（管理员尚未配置：请部署者在 config.js 的 owner 中填写管理员 QQ 号）"
            : "";
        ctx.adapter.sendMsg(ctx.space, `无权限：该指令仅管理员可用${hint}`);
        return true;
    }

    const result = await command.handler(args, ctx);
    if (result !== null && result !== undefined) {
        ctx.adapter.sendMsg(ctx.space, result);
    }
    return true;
}
