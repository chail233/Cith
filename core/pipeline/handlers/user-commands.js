import { getWeatherText } from "../../services/weather.js";
import { getRecorder, listSessions } from "../../llm/session.ts";
import config from "../../config.js";
import {skills, forceSkills} from "../../llm/skill.js";
import {reloadSkills} from "../../llm/skill.js";
import {mcpClient} from "../../llm/mcp-client.js";
import {getAllTools} from "../../llm/tools.js";
import {confirm as doConfirm, cancel as doCancel, list as doList} from "../../llm/tool-approval.js";
import chat from "../../llm/chat.js";
import logger from "../../utils/logger.js";

const cmds = [
    {
        name: "gw",
        description: "查询天气",
        params: [{ name: "城市", desc: "城市名称" }],
        handler: async (args, ctx) => {
            if (!args[0]) return "请指定城市名，例如 #gw 杭州";
            return await getWeatherText(args[0]);
        }
    },
    {
        name: "clear",
        needsAdmin: true,
        description: "清除短期记忆（管理员）",
        params: [],
        handler: async (args, ctx) => {
            const recorder = getRecorder(ctx.space);
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
        name: "msgs",
        needsAdmin: true,
        description: "列出短期记录",
        params: [],
        handler: async (args, ctx) => {
            const all = getRecorder(ctx.space).getAll();
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
            const all = getRecorder(ctx.space).getCache();
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
            const summary = getRecorder(ctx.space).getMidSummary();
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
                await getRecorder(ctx.space).compress();
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
            const list = listSessions();
            if (list.length === 0) return "当前没有活跃会话";
            const lines = list.map(s =>
                `${s.id}：短期 ${s.short} 条，缓存 ${s.cache} 条，${s.hasSummary ? "有概要" : "无概要"}，空闲 ${s.idleMin} 分钟`
            );
            return `活跃会话（${list.length} 个）：\n${lines.join("\n")}`;
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
            const result = await doConfirm(args[0]);
            if (!result.ok) return result.text;
            chat(ctx).catch(err => {
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
    if (!ctx.text.startsWith("#")) return false;

    const { cmd, args } = parseCommand(ctx.text);
    if (!cmd) {
        ctx.adapter.sendMsg(ctx.space, "指令格式无效");
        return true;
    }

    const command = USER_CMD_MAP.get(cmd);
    if (!command) return false;

    if (command.needsAdmin && !ctx.isAdmin) {
        ctx.adapter.sendMsg(ctx.space, "无权限");
        return true;
    }

    const result = await command.handler(args, ctx);
    if (result !== null && result !== undefined) {
        ctx.adapter.sendMsg(ctx.space, result);
    }
    return true;
}
