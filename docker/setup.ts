import { randomBytes, randomUUID } from "node:crypto";
import { constants, accessSync, cpSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Prompter, parseIdList } from "../scripts/setup.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const profile = resolve(process.env.CITH_DATA || join(root, "profile"));
const configPath = resolve(process.env.CITH_CONFIG || join(profile, "config.json"));

function checkProfile(): void {
    try {
        mkdirSync(profile, { recursive: true, mode: 0o750 });
        accessSync(profile, constants.W_OK | constants.X_OK);
    }
    catch {
        throw new Error(`数据目录不可写：${profile}。请确认宿主机 profile/ 的权限与容器 UID:GID（${process.getuid?.()}:${process.getgid?.()}）匹配。`);
    }
}

function prepare(): void {
    if (!existsSync(configPath)) {
        throw new Error(`配置文件不存在：${configPath}。请先运行 docker compose run --rm core setup，或将已有配置放入 profile/config.json。`);
    }
    let config: unknown;
    try {
        config = JSON.parse(readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
    }
    catch {
        throw new Error(`无法读取配置：${configPath}。请检查文件权限和 JSON 语法。`);
    }
    if (typeof config !== "object" || config === null || Array.isArray(config)) {
        throw new Error(`配置的顶层必须是 JSON 对象：${configPath}`);
    }
    for (const name of ["prompts", "skills", "stickers"]) {
        cpSync(join(root, "dist", name), join(profile, name), { recursive: true, force: false });
    }
}

function checkUrl(value: string): string | null {
    try {
        if (["http:", "https:"].includes(new URL(value).protocol)) return null;
    }
    catch { /* 统一提示格式 */ }
    return "请输入 http(s):// 开头的完整接口地址";
}

async function configure(): Promise<void> {
    if (existsSync(configPath)) {
        process.stdout.write(`已有配置：${configPath}。请编辑宿主机上的 profile/config.json 后重启。\n`);
        return;
    }

    const p = new Prompter();
    try {
        const llmApiUrl = await p.ask("OpenAI 兼容接口地址", {
            default: "https://api.openai.com/v1",
            validate: checkUrl,
        });
        const chatModel = await p.ask("聊天模型名称", { required: true });
        const aiApiKey = await p.ask("模型 API Key", { required: true, secret: true });
        const enableOnebot = await p.confirm("启用 QQ（NapCat）？", true);
        const enableWechat = await p.confirm("启用微信？", false);
        const owner = parseIdList(await p.ask("管理员 ID，多个用逗号分隔", {
            ...(enableOnebot ? { required: true } : { default: "desktop" }),
        }));
        const selfId = enableOnebot
            ? await p.ask("机器人 QQ 号", {
                required: true,
                validate: id => /^\d{5,12}$/.test(id) ? null : "请输入 5–12 位数字 QQ 号",
            })
            : undefined;
        const targetGroupId = enableOnebot
            ? parseIdList(await p.ask("允许的群号，可用逗号分隔；留空则由管理员在群内用 #bind 绑定"))
            : [];
        const targetUserId = parseIdList(await p.ask("允许私聊的 ID，多个用逗号分隔；输入 * 放行所有私聊", {
            default: enableWechat ? "*" : [...new Set([...owner, "desktop"])].join(","),
        }));
        const generatedToken = randomBytes(24).toString("hex");
        const token = enableOnebot
            ? await p.ask("NapCat 接入 token（回车随机生成；两端需填相同值）", {
                default: generatedToken,
                secret: true,
                validate: value => value.length >= 8 && !/^your_/i.test(value)
                    ? null : "请使用至少 8 位的实际 token",
            })
            : generatedToken;

        const config = {
            llmApiUrl,
            chatModel,
            aiApiKey,
            enableOnebot,
            enableWechat,
            enableLongTermMemory: false,
            wechatStorageDir: join(profile, "wechatbot"),
            owner,
            selfId,
            targetGroupId: targetGroupId.length > 0 ? targetGroupId : undefined,
            targetUserId: targetUserId.includes("*") ? [] : targetUserId,
            token,
            web: { token: randomBytes(24).toString("hex") },
        };

        mkdirSync(dirname(configPath), { recursive: true, mode: 0o750 });
        const tmp = `${configPath}.${randomUUID()}.tmp`;
        try {
            writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
            // 原子发布完整配置，并保留其他初始化进程已经写入的配置。
            linkSync(tmp, configPath);
        }
        finally {
            rmSync(tmp, { force: true });
        }
        process.stdout.write("配置已保存到 profile/config.json。运行 docker compose up -d 启动。\n");
        if (enableOnebot) {
            process.stdout.write("在 NapCat 的反向 WebSocket 中填写 Core 的地址，并使用 config.json 中的 token。\n");
        }
    }
    finally {
        p.close();
    }
}

try {
    checkProfile();
    if (process.argv[2] === "setup") await configure();
    else prepare();
}
catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "__CANCEL__") {
        process.stderr.write("已取消配置。\n");
        process.exitCode = 130;
    }
    else {
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
    }
}
