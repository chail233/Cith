import { getRecorder, sessionIdOf } from "./session.ts";
import {makeMemoryUserId, searchMemory, getUserProfile} from "./long-term-memory.js";
import config from "../config.js";
import logger from "../utils/logger.js";
import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir, rm, readdir, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { resolveSrcPath, checkPathWhitelist } from "../utils/file-security.js";
import {mcpClient} from "./mcp-client.js";
import {hold} from "./tool-approval.js";
import {setPlan, getPlan, renderPlan} from "./plan.ts";

/**
 *模型可以调用的工具
 */
const tools = [
    {
        type: "function",
        function: {
            name: "get_memory",
            description: "根据当前对话内容搜索相关记忆",
            parameters: {},
        },
    },
    {
        type: "function",
        function: {
            name: "get_user_profile",
            description: "根据用户 ID 获取该用户的画像信息，可用于了解特定用户的偏好、性格等",
            parameters: {
                type: "object",
                properties: {
                    id: {
                        type: "string",
                        description: "用户的 ID（QQ 号或微信加密 ID）",
                    },
                },
                required: ["id"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "read_file",
            description: "读取指定路径的文件内容",
            parameters: {
                type: "object",
                properties: {
                    filepath: {
                        type: "string",
                        description: "相对于 core/ 目录的文件路径",
                    },
                },
                required: ["filepath"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "run_JS",
            description: "运行 JavaScript 脚本，可通过 args 传递参数给脚本。",
            parameters: {
                type: "object",
                properties: {
                    filepath: {
                        type: "string",
                        description: "相对于 core/ 的JavaScript 脚本文件路径",
                    },
                    args: {
                        type: "object",
                        description: "传递给脚本的参数，脚本通过 process.argv[2] 接收（JSON 字符串）",
                    },
                },
                required: ["filepath"],
            }
        }
    },
    {
        type: "function",
        function: {
            name: "create_file",
            description: "在指定路径创建新文件。文件必须不存在，否则会被拒绝。",
            parameters: {
                type: "object",
                properties: {
                    filepath: {
                        type: "string",
                        description: "相对于 core/ 的文件路径",
                    },
                    content: {
                        type: "string",
                        description: "文件内容",
                    },
                },
                required: ["filepath", "content"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "delete_file",
            description: "删除指定路径的文件。此操作不可逆。",
            parameters: {
                type: "object",
                properties: {
                    filepath: {
                        type: "string",
                        description: "相对于 core/ 的文件路径",
                    },
                },
                required: ["filepath"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "list_files",
            description: "列出指定目录下的文件和子目录",
            parameters: {
                type: "object",
                properties: {
                    dirpath: {
                        type: "string",
                        description: "相对于 core/ 的目录路径",
                    },
                },
                required: ["dirpath"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "edit_file",
            description: "通过搜索替换的方式编辑文件内容。每个编辑操作需提供要查找的原文和替换后的新文本，原文必须在文件中唯一匹配。多个 edit 之间是有顺序依赖的。",
            parameters: {
                type: "object",
                properties: {
                    filepath: {
                        type: "string",
                        description: "相对于 core/ 的文件路径",
                    },
                    edits: {
                        type: "array",
                        description: "编辑操作列表，每个操作包含 oldText（要查找的原文）和 newText（替换后的内容）",
                        items: {
                            type: "object",
                            properties: {
                                oldText: {
                                    type: "string",
                                    description: "要被替换的原始文本片段，必须在文件中唯一匹配，请包含足够上下文以确保唯一性",
                                },
                                newText: {
                                    type: "string",
                                    description: "替换后的新文本",
                                },
                            },
                            required: ["oldText", "newText"],
                        },
                    },
                },
                required: ["filepath", "edits"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "list_mcp_tools",
            description: "将指定mcp的工具加入工具列表，仅生效一次",
            parameters: {
                type: "object",
                properties: {
                    mcpName: {
                        type: "string",
                        description: "mcp名称",
                    },
                },
                required: ["mcpName"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "manage_plan",
            description: "创建或更新当前任务计划。每次提交总体目标与完整任务清单覆盖旧计划；空数组表示任务结束并清空计划",
            parameters: {
                type: "object",
                properties: {
                    goal: {
                        type: "string",
                        description: "本计划要达成的总体目标，一句话",
                    },
                    todos: {
                        type: "array",
                        description: "完整任务清单，按执行顺序排列",
                        items: {
                            type: "object",
                            properties: {
                                content: {
                                    type: "string",
                                    description: "步骤描述，简短",
                                },
                                status: {
                                    type: "string",
                                    enum: ["pending", "in_progress", "done", "cancelled"],
                                    description: "步骤状态，同一时间最多一个 in_progress",
                                },
                            },
                            required: ["content", "status"],
                        },
                    },
                },
                required: ["goal", "todos"],
            },
        },
    },
]


let mcpTools = [];

export function getAllTools() {
    const rt = [...mcpTools];
    mcpTools = [];
    return [...tools, ...rt];
}


/**
 * 搜索长期记忆（使用当前会话的短期上下文作为查询线索）
 * @param {object} param
 * @param {{space?: import("../types/index.ts").Space}|null} [ctx]
 */
async function getMemory(param, ctx) {
    if (!ctx?.space) return "无法确定当前会话，无法搜索记忆";
    const chatRecorder = getRecorder(ctx.space);
    const shortTermMessages = chatRecorder.getAll();
    if (shortTermMessages.length > 0) {
        const userId = makeMemoryUserId(sessionIdOf(ctx.space));

        const userMessages = shortTermMessages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .slice(-10);

        if (userMessages.length === 0) return "没有有效对话记录";

        const recalled = await searchMemory(userId, userMessages);
        logger.debug("长期记忆搜索结果:", recalled);
        return recalled.join("\n---\n") || "没有找到相关记忆";
    }
    return "没有对话记录，无法搜索记忆";
}

/**
 * 获取指定用户的画像信息
 * @param {{id: string}} param
 */
async function getUserProfileTool(param) {
    const id = param?.id;
    if (!id) return "缺少用户 ID 参数";
    const profile = await getUserProfile(id);
    if (!profile) return `未找到用户 ${id} 的用户画像`;
    return profile;
}


async function readFile(param) {
    const filepath = param?.filepath;
    if (!filepath) return "缺少文件路径参数";

    const pathResult = resolveSrcPath(filepath);
    if (pathResult.error) return pathResult.error;

    try {
         return await fsReadFile(pathResult.fullPath, "utf-8");
    }
    catch (err) {
        if (err.code === "ENOENT") return `文件 "${filepath}" 不存在`;
        return `读取文件失败: ${err.message}`;
    }
}




/**
 * 运行指定路径的 JS 脚本并返回执行结果
 * 安全策略：路径穿越防护 + 仅限 .js 文件（白名单门禁已上移至 callTool）
 * @param {{filepath: string, args?: object}} param
 */
async function runJS(param) {
    const filepath = param?.filepath;
    if (!filepath) return "缺少文件路径参数";

    // 仅允许 .js 文件
    if (extname(filepath) !== ".js") {
        return "只能执行 .js 文件";
    }

    const pathResult = resolveSrcPath(filepath);
    if (pathResult.error) return pathResult.error;

    try {
        // 在子进程中执行脚本，参数通过 process.argv[2] 以 JSON 形式传递
        const args = param?.args ?? {};
        const argsJson = JSON.stringify(args);

        // --use-system-ca 仅在 Windows 上需要，用于使用系统证书存储解决 SSL 问题
        const nodeArgs = process.platform === "win32"
            ? ["--use-system-ca", pathResult.fullPath, argsJson]
            : [pathResult.fullPath, argsJson];

        const { stdout, stderr } = await new Promise((resolve, reject) => {
            execFile(process.execPath, nodeArgs, { timeout: 30000 }, (error, stdout, stderr) => {
                if (error) {
                    if (stderr) reject(new Error(stderr.trim()));
                    else reject(error);
                }
                else {
                    resolve({ stdout, stderr });
                }
            });
        });
        const output = stdout.trim();
        if (output) return output;
        if (stderr.trim()) return `脚本执行完成，但有警告输出:\n${stderr.trim()}`;
        return "脚本执行成功（无输出）";
    }
    catch (err) {
        if (err.code === "ENOENT") {
            return `脚本文件 "${filepath}" 不存在`;
        }
        if (err.killed) {
            return "脚本执行超时（30秒限制）";
        }
        return `脚本执行失败: ${err.message}`;
    }
}


/**
 * 在指定路径创建新文件
 * 安全策略：路径穿越防护 + 禁止覆盖已有文件（白名单门禁已上移至 callTool）
 * @param {{filepath: string, content: string}} param
 */
async function createFile(param) {
    const filepath = param?.filepath;
    const content = param?.content;
    if (!filepath) return "缺少文件路径参数";
    if (content === undefined || content === null) return "缺少文件内容参数";

    const pathResult = resolveSrcPath(filepath);
    if (pathResult.error) return pathResult.error;

    try {
        // 确保父目录存在
        await mkdir(dirname(pathResult.fullPath), { recursive: true });

        // 使用 wx 标志：文件已存在时写入失败，防止意外覆盖
        await fsWriteFile(pathResult.fullPath, content, { encoding: "utf-8", flag: "wx" });
        return `文件 "${filepath}" 创建成功`;
    }
    catch (err) {
        if (err.code === "EEXIST") return `文件 "${filepath}" 已存在，无法覆盖。如需修改请使用 edit_file`;
        return `创建文件失败: ${err.message}`;
    }
}


/**
 * 删除指定路径的文件
 * 安全策略：路径穿越防护 + 仅限文件（白名单门禁已上移至 callTool）
 * @param {{filepath: string}} param
 */
async function deleteFile(param) {
    const filepath = param?.filepath;
    if (!filepath) return "缺少文件路径参数";

    const pathResult = resolveSrcPath(filepath);
    if (pathResult.error) return pathResult.error;

    try {
        await rm(pathResult.fullPath);
        return `文件 "${filepath}" 删除成功`;
    }
    catch (err) {
        if (err.code === "ENOENT") return `文件 "${filepath}" 不存在`;
        if (err.code === "EISDIR") return `"${filepath}" 是目录，不允许删除目录`;
        return `删除文件失败: ${err.message}`;
    }
}


/**
 * 通过搜索替换编辑文件内容
 * 安全策略：路径穿越防护 + 唯一匹配校验（白名单门禁已上移至 callTool）
 * @param {{filepath: string, edits: Array<{oldText: string, newText: string}>}} param
 */
async function editFile(param) {
    const filepath = param?.filepath;
    const edits = param?.edits;
    if (!filepath) return "缺少文件路径参数";
    if (!Array.isArray(edits) || edits.length === 0) return "缺少编辑操作（edits 必须为非空数组）";

    const pathResult = resolveSrcPath(filepath);
    if (pathResult.error) return pathResult.error;

    // 读取原文
    let content;
    try {
        content = await fsReadFile(pathResult.fullPath, "utf-8");
    }
    catch (err) {
        if (err.code === "ENOENT") return `文件 "${filepath}" 不存在`;
        return `读取文件失败: ${err.message}`;
    }

    // 逐个应用编辑
    for (let i = 0; i < edits.length; i++) {
        const { oldText, newText } = edits[i];
        if (!oldText) return `第 ${i + 1} 个编辑失败：oldText 不能为空`;

        // 查找匹配位置（找到 2 个即停止，足以判断唯一性）
        const indices = [];
        let pos = 0;
        while ((pos = content.indexOf(oldText, pos)) !== -1) {
            indices.push(pos);
            if (indices.length >= 2) break;
            pos += 1;
        }

        if (indices.length === 0) {
            return `第 ${i + 1} 个编辑失败：在文件中找不到指定的文本`;
        }

        if (indices.length > 1) {
            // 计算匹配到的行号，帮助 AI 定位
            const lineNums = indices.map(idx => {
                return content.slice(0, idx).split("\n").length;
            });
            return `第 ${i + 1} 个编辑失败：匹配到多处（如第 ${lineNums.join(", ")} 行等），请在 oldText 中包含更多上下文以精确定位`;
        }

        // 唯一匹配，执行替换
        content = content.slice(0, indices[0]) + newText + content.slice(indices[0] + oldText.length);
    }

    // 写回文件
    try {
        await fsWriteFile(pathResult.fullPath, content, "utf-8");
        return "文件编辑成功";
    }
    catch (err) {
        return `写入文件失败: ${err.message}`;
    }
}


/**
 * 列出指定目录下的文件和子目录
 * 安全策略：路径穿越防护（白名单门禁已上移至 callTool）
 * @param {{dirpath: string}} param
 */
async function listFiles(param) {
    const dirpath = param?.dirpath;
    if (!dirpath) return "缺少目录路径参数";

    const pathResult = resolveSrcPath(dirpath);
    if (pathResult.error) return pathResult.error;

    try {
        const entries = await readdir(pathResult.fullPath);
        if (entries.length === 0) return `目录 "${dirpath}" 为空`;

        // 获取每个条目的类型信息
        const details = await Promise.all(
            entries.map(async (name) => {
                try {
                    const s = await stat(resolve(pathResult.fullPath, name));
                    return s.isDirectory() ? `${name}/` : name;
                }
                catch {
                    return name;
                }
            })
        );

        return details.join("\n");
    }
    catch (err) {
        if (err.code === "ENOENT") return `目录 "${dirpath}" 不存在`;
        if (err.code === "ENOTDIR") return `"${dirpath}" 不是目录`;
        return `列出目录失败: ${err.message}`;
    }
}


async function listMcpTools(param) {
    const newTools = await mcpClient.getToolDefinitionOfServer(param.mcpName);
    mcpTools.push(...newTools);
    return `已将 ${param.mcpName} 的工具加入工具列表`;
}

/**
 * 创建/更新当前会话的任务计划（目标 + 步骤清单全量覆盖，空数组清空）
 * @param {{goal?: string, todos: Array<{content: string, status: string}>}} param
 * @param {{space?: import("../types/index.ts").Space}} [ctx]
 */
async function managePlan(param, ctx) {
    if (!ctx?.space) return "无法确定当前会话，计划未保存";
    const sessionId = sessionIdOf(ctx.space);
    const todos = param?.todos;
    if (!Array.isArray(todos)) return "缺少参数 todos（完整任务清单数组）";
    setPlan(sessionId, param?.goal, todos);
    const plan = getPlan(sessionId);
    if (!plan) return "计划已清空";
    return `当前计划：\n${renderPlan(plan)}`;
}


const toolMap = new Map(
    [
        ["get_memory", getMemory],
        ["get_user_profile", getUserProfileTool],
        ["read_file", readFile],
        ["run_JS", runJS],
        ["edit_file", editFile],
        ["create_file", createFile],
        ["delete_file", deleteFile],
        ["list_files", listFiles],
        ["list_mcp_tools", listMcpTools],
        ["manage_plan", managePlan]
    ]
);

/**
 * 细粒度文件工具 → 执行对象所属白名单目录的配置键
 * 门禁统一在 callTool：对象在白名单内直接放行，否则挂起待管理员确认
 */
const pathToolWhitelist = {
    read_file: { dirKey: "readFileDirs", pathKey: "filepath" },
    list_files: { dirKey: "readFileDirs", pathKey: "dirpath" },
    run_JS: { dirKey: "runJsDirs", pathKey: "filepath" },
    create_file: { dirKey: "editFileDirs", pathKey: "filepath" },
    delete_file: { dirKey: "editFileDirs", pathKey: "filepath" },
    edit_file: { dirKey: "editFileDirs", pathKey: "filepath" },
};


/**
 * 调用工具
 * @param {object} tool_call 完整的工具调用对象 { id, function: { name, arguments } }
 * @param {{isAdmin?: boolean, userId?: string, senderName?: string}} [ctx] 请求上下文
 * @param {boolean} [confirmed=false] 是否已确认
 */
export async function callTool(tool_call, ctx, confirmed = false){
    const name = tool_call.function.name;
    const parameter = JSON.parse(tool_call.function.arguments);

    if(config.toolOutput) ctx.adapter.sendMsg(ctx.space, `尝试调用${name}，参数为${JSON.stringify(parameter)}`);

    // 安全门禁：非管理员且未确认时，文件类工具按"执行对象是否在对应白名单内"决定放行或挂起
    if (!confirmed && !ctx?.isAdmin) {
        const rule = pathToolWhitelist[name];
        if (rule) {
            // 细粒度文件工具：对象在白名单目录内 → 放行；否则挂起待确认
            const pathArg = parameter[rule.pathKey];
            const resolved = pathArg ? resolveSrcPath(pathArg) : null;
            if (resolved && !resolved.error) {
                const whitelist = config[rule.dirKey] ?? [];
                const allowed = !checkPathWhitelist(resolved.fullPath, whitelist).error;
                if (!allowed) {
                    const id = hold(tool_call, ctx);
                    if (!id) return `${name} 被拒绝：待确认队列已满，请稍后再试`;
                    return `操作对象不在白名单目录内，需要管理员确认。已登记为待确认操作 #${id}。`;
                }
            }
            // 路径非法或缺参：交由工具自身返回具体错误
        }
    }

    if (name.startsWith("mcp_")) {
        const originalName = name.slice(4);
        const result = await mcpClient.callTool(originalName, parameter);
        return `${name}调用结果:\n${result}`;
    }

    const tool = toolMap.get(name);
    if (!tool) {
        throw new Error(`未知工具: ${name}`);
    }
    return `${name}调用结果:\n${await tool(parameter, ctx)}`;
}


