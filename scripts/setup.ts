/**
 * Cith 一键初始化脚本
 *
 */
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";

const execFileAsync = promisify(execFile);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_JS = join(ROOT, "core", "config.js");
const CONFIG_DEV = join(ROOT, "core", "configDev.js");
const WEB_ENV = join(ROOT, "web", ".env");
const WEB_DIST = join(ROOT, "web", "dist", "index.html");

const DEFAULT_LLM_URL = "https://workspace.aliyuncs.com/v1/chat/completions";
const DEFAULT_CHAT_MODEL = "deepseek-v4.1-flash-1017";
const DEFAULT_NAPCAT_HTTP = "127.0.0.1:3000";
const DEFAULT_WS_PORT = 8080;
const DEFAULT_WEB_PORT = 2145;
const DEFAULT_BFF_PORT = 2146;

// ===== 终端输出 =====

const COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code: string, text: string): string => (COLOR ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = (t: string) => paint("1", t);
const dim = (t: string) => paint("2", t);
const green = (t: string) => paint("32", t);
const yellow = (t: string) => paint("33", t);
const red = (t: string) => paint("31", t);
const cyan = (t: string) => paint("36", t);

const say = (text = ""): void => { process.stdout.write(`${text}\n`); };
const ok = (text: string): void => say(`  ${green("✓")} ${text}`);
const warn = (text: string): void => say(`  ${yellow("!")} ${text}`);
const bad = (text: string): void => say(`  ${red("×")} ${text}`);
const note = (text: string): void => say(`  ${dim(text)}`);
const heading = (text: string): void => say(`\n${cyan("▶")} ${bold(text)}`);

// ===== 交互输入（自实现 raw 模式，密码不回显） =====

interface AskOptions {
    default?: string;
    required?: boolean;
    /** 隐藏输入内容（密码 / 密钥） */
    secret?: boolean;
    /** 返回错误文案表示校验不通过，null 表示通过 */
    validate?: (value: string) => string | null;
}

type RawStdin = NodeJS.ReadStream & {
    setRawMode?: (mode: boolean) => void;
    isRaw?: boolean;
};

class Prompter {
    constructor() {
        if (!process.stdin.isTTY) {
            throw new Error("需要交互式终端：请直接在终端里运行（只做只读检查用 --check）");
        }
    }

    async ask(label: string, opts: AskOptions = {}): Promise<string> {
        for (;;) {
            const hint = opts.default === undefined
                ? ""
                : opts.secret ? dim(" [回车沿用已生成的值]") : dim(` [${opts.default}]`);
            const raw = await this.readLine(`${cyan("?")} ${label}${hint}: `, opts.secret === true);
            let value = raw.trim();
            if (value === "") {
                if (opts.default !== undefined) value = opts.default;
                else if (opts.required) {
                    note("该项必填，不能留空");
                    continue;
                }
            }
            if (opts.validate) {
                const problem = opts.validate(value);
                if (problem) {
                    note(problem);
                    continue;
                }
            }
            return value;
        }
    }

    async confirm(label: string, def: boolean): Promise<boolean> {
        const raw = await this.ask(`${label} ${def ? "(Y/n)" : "(y/N)"}`, { default: def ? "y" : "n" });
        return /^y(es)?$/i.test(raw);
    }

    async askPort(label: string, def: number): Promise<number> {
        const raw = await this.ask(label, {
            default: String(def),
            validate: (v) => {
                const n = Number(v);
                return Number.isInteger(n) && n > 0 && n < 65536 ? null : "请输入 1-65535 之间的整数";
            },
        });
        return Number(raw);
    }

    /** 读取一行；secret 为 true 时只回显星号 */
    private readLine(prompt: string, secret: boolean): Promise<string> {
        const stdin = process.stdin as RawStdin;
        process.stdout.write(prompt);
        stdin.setRawMode?.(true);
        stdin.resume();
        stdin.setEncoding("utf8");

        return new Promise<string>((resolveLine, rejectLine) => {
            let value = "";
            /** 跳过方向键等转义序列的剩余字符（ESC [ A 这类固定 3 字符） */
            let skip = 0;

            const finish = (result: string | null, error?: Error): void => {
                stdin.removeListener("data", onData);
                stdin.setRawMode?.(false);
                stdin.pause();
                process.stdout.write("\n");
                if (error) rejectLine(error);
                else resolveLine(result ?? "");
            };

            const onData = (chunk: string): void => {
                for (const ch of chunk) {
                    if (skip > 0) {
                        skip -= 1;
                        continue;
                    }
                    if (ch === "\u001b") {
                        skip = 2;
                        continue;
                    }
                    if (ch === "\r" || ch === "\n" || ch === "\u0004") {
                        finish(value);
                        return;
                    }
                    if (ch === "\u0003") {
                        finish(null, new Error("__CANCEL__"));
                        return;
                    }
                    if (ch === "\u007f" || ch === "\b") {
                        if (value.length > 0) {
                            value = value.slice(0, -1);
                            process.stdout.write("\b \b");
                        }
                        continue;
                    }
                    // 忽略其余控制字符（方向键序列等）
                    if (ch < " ") continue;
                    value += ch;
                    process.stdout.write(secret ? "*" : ch);
                }
            };

            stdin.on("data", onData);
        });
    }
}

// ===== 纯函数：生成配置文本（导出便于单测，不触碰真实文件） =====

export interface SetupAnswers {
    owner: string;
    selfId: string;
    targetGroupId: string[];
    targetUserId: string[];
    llmApiUrl: string;
    aiApiKey: string;
    chatModel: string;
    visionApiKey: string;
    visionModel: string;
    llmVisionApiUrl: string;
    enableLongTermMemory: boolean;
    memoryOllamaUrl: string;
    memoryEmbedModel: string;
    wsPort: number;
    napcatHttpHost: string;
    napcatToken: string;
    webPort: number;
    webToken: string;
    bffPort: number;
    webPassword: string;
    sslEnabled: boolean;
    serverIp: string;
}

/** 逗号 / 空格 / 中文逗号分隔的 ID 列表 → 去重数组 */
export function parseIdList(text: string): string[] {
    const parts = text.split(/[,，\s]+/).map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    return [...new Set(parts)];
}

/** 生成 core/configDev.js 内容 */
export function buildConfigDevSource(a: SetupAnswers, now: Date = new Date()): string {
    const lines: string[] = [];
    const push = (key: string, value: unknown): void => { lines.push(`    ${key}: ${JSON.stringify(value)},`); };

    push("devMode", true);
    push("owner", a.owner);
    push("selfId", a.selfId);
    if (a.targetGroupId.length > 0) push("targetGroupId", a.targetGroupId);
    if (a.targetUserId.length > 0) push("targetUserId", a.targetUserId);
    push("llmApiUrl", a.llmApiUrl);
    push("aiApiKey", a.aiApiKey);
    push("chatModel", a.chatModel);
    push("llmVisionApiUrl", a.llmVisionApiUrl);
    push("visionApiKey", a.visionApiKey);
    push("visionModel", a.visionModel);
    if (a.enableLongTermMemory) {
        push("enableLongTermMemory", true);
        push("memoryOllamaUrl", a.memoryOllamaUrl);
        push("memoryEmbedModel", a.memoryEmbedModel);
    }
    push("token", a.napcatToken);
    if (a.wsPort !== DEFAULT_WS_PORT) push("wsPort", a.wsPort);
    if (a.napcatHttpHost !== DEFAULT_NAPCAT_HTTP) push("napcatHttpHost", a.napcatHttpHost);
    // web 为对象整体覆盖：四个字段必须写全，否则 path / logBufferSize 会丢
    lines.push("    web: {");
    lines.push(`        port: ${a.webPort},`);
    lines.push(`        path: "/api/v1/ws",`);
    lines.push(`        token: ${JSON.stringify(a.webToken)},`);
    lines.push(`        logBufferSize: 1000,`);
    lines.push("    },");

    return [
        "/**",
        " * Cith 开发环境配置（由 scripts/setup.ts 生成）",
        ` * 生成时间：${now.toISOString()}`,
        " * 已被 .gitignore 忽略；只写需要覆盖 core/config.js 默认值的字段",
        " */",
        "export default {",
        ...lines,
        "};",
        "",
    ].join("\n");
}

/** .env 值：含空白或特殊字符时加双引号，避免被解析截断 */
export function envValue(value: string): string {
    if (value === "") return "";
    return /^[A-Za-z0-9_\-.:/@+]+$/.test(value) ? value : `"${value.replace(/"/g, "\\\"")}"`;
}

/** 解析 .env 文本（够用即可：不处理多行值） */
export function parseEnvText(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
        if (!m) continue;
        out[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
    }
    return out;
}

/**
 * 把键值合并进已有 .env：命中的行原地替换，未出现的键追加到末尾，注释与无关键保留
 */
export function mergeEnvText(existing: string, values: Record<string, string>): string {
    const pending = new Map(Object.entries(values));
    const out: string[] = [];
    const source = existing === "" ? [] : existing.split(/\r?\n/);

    for (const line of source) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
        if (m && pending.has(m[1])) {
            const key = m[1];
            out.push(`${key}=${envValue(pending.get(key) ?? "")}`);
            pending.delete(key);
        }
        else {
            out.push(line);
        }
    }

    if (pending.size > 0) {
        if (out.length > 0 && out[out.length - 1] !== "") out.push("");
        out.push("# 由 scripts/setup.ts 写入");
        for (const [key, value] of pending) out.push(`${key}=${envValue(value)}`);
    }

    return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

/** 首次生成 web/.env 时的完整模板（保留注释，便于用户理解每个键） */
export function buildEnvTemplate(values: Record<string, string>): string {
    return [
        "# Web 面板（BFF）监听端口",
        `WEB_PORT=${envValue(values.WEB_PORT ?? "")}`,
        "",
        "# HTTPS 自签名证书开关（true 启用 https，首次访问需在浏览器信任一次）",
        `WEB_SSL_ENABLED=${envValue(values.WEB_SSL_ENABLED ?? "false")}`,
        "# 写入证书 SAN 的公网 IP（留空则仅含 localhost/127.0.0.1）",
        `WEB_SERVER_IP=${envValue(values.WEB_SERVER_IP ?? "")}`,
        "",
        "# 控制台登录密码（留空表示不设登录）",
        `WEB_PASSWORD=${envValue(values.WEB_PASSWORD ?? "")}`,
        "",
        "# Bot 面板 API（WebSocket）：token 必须与 core/config.js 的 web.token 一致",
        `BOT_API_URL=${envValue(values.BOT_API_URL ?? "")}`,
        `BOT_API_TOKEN=${envValue(values.BOT_API_TOKEN ?? "")}`,
        "",
    ].join("\n");
}

/** 构造 web/.env 的关键键值（BFF 端口、token 自动与 Bot 对齐） */
export function buildEnvValues(a: SetupAnswers): Record<string, string> {
    return {
        WEB_PORT: String(a.bffPort),
        WEB_SSL_ENABLED: a.sslEnabled ? "true" : "false",
        WEB_SERVER_IP: a.serverIp,
        WEB_PASSWORD: a.webPassword,
        BOT_API_URL: `ws://127.0.0.1:${a.webPort}/api/v1/ws`,
        BOT_API_TOKEN: a.webToken,
    };
}

// ===== 环境 / 依赖 / 端口 =====

interface Flags {
    force: boolean;
    noStart: boolean;
    check: boolean;
    skipInstall: boolean;
    help: boolean;
}

function parseFlags(argv: string[]): Flags {
    const flags: Flags = { force: false, noStart: false, check: false, skipInstall: false, help: false };
    for (const arg of argv) {
        if (arg === "--force" || arg === "-f") flags.force = true;
        else if (arg === "--no-start") flags.noStart = true;
        else if (arg === "--check") flags.check = true;
        else if (arg === "--skip-install") flags.skipInstall = true;
        else if (arg === "--help" || arg === "-h") flags.help = true;
        else throw new Error(`未知参数 ${arg}（用 --help 查看可用参数）`);
    }
    return flags;
}

function printHelp(): void {
    say(`
${bold("Cith 一键初始化")}

用法：node scripts/setup.ts [选项]
       npm run setup -- [选项]

选项：
  --check         只读检查：环境、依赖、配置能否加载、端口、.env 是否与 Bot 对齐
  --no-start      只写配置并做校验，不启动进程
  --force         已存在 configDev.js / .env 时备份后重新生成
  --skip-install  跳过 npm install（依赖已装好时加快启动）
  -h, --help      显示本帮助

脚本只会生成两个文件（均已被 .gitignore 忽略）：
  core/configDev.js   开发环境配置，devMode 保持 true
  web/.env            面板 BFF 配置，token 自动与 Bot 对齐
`);
}

function assertProjectRoot(): void {
    const pkgPath = join(ROOT, "package.json");
    if (!existsSync(pkgPath)) throw new Error(`未找到 package.json：${pkgPath}`);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
    if (pkg.name !== "sunbatwobot") {
        throw new Error(`当前目录不是 Cith 项目根（package.json 的 name 为 ${pkg.name ?? "?"}）`);
    }
}

function checkNode(): void {
    heading("环境检查");
    const major = Number(process.versions.node.split(".")[0]);
    if (major < 24) {
        bad(`Node.js ${process.versions.node} 版本过低，项目要求 >= 24`);
        note("安装地址：https://nodejs.org （或用 nvm/fnm 切换：nvm use 24）");
        throw new Error("Node.js 版本不满足要求");
    }
    ok(`Node.js v${process.versions.node}`);
}

function checkDevMode(strict: boolean): void {
    if (!existsSync(CONFIG_JS)) throw new Error(`未找到 ${CONFIG_JS}`);
    const text = readFileSync(CONFIG_JS, "utf8");
    if (/devMode\s*:\s*false/.test(text)) {
        if (!strict) {
            warn("core/config.js 处于生产模式（devMode: false）：本脚本不会写 configDev.js，检查的是 config.js 内的配置");
            return;
        }
        bad("core/config.js 处于生产模式（devMode: false），本脚本写入的 configDev.js 不会生效");
        note("修复（二选一）：");
        note("  1. 把 core/config.js 里的 devMode 改回 true，再重新运行本脚本");
        note("  2. 保持生产模式，直接手工在 core/config.js 里填写 owner / aiApiKey 等，然后 npm run setup -- --check");
        throw new Error("devMode 为 false，无法写入开发配置");
    }
    ok("core/config.js 处于开发模式（devMode: true）");
}

async function npmRun(args: string[], cwd: string): Promise<void> {
    await new Promise<void>((resolveRun, rejectRun) => {
        const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", args, {
            cwd,
            stdio: "inherit",
            shell: process.platform === "win32",
        });
        child.on("error", rejectRun);
        child.on("exit", (code) => {
            if (code === 0) resolveRun();
            else rejectRun(new Error(`npm ${args.join(" ")} 失败（退出码 ${code ?? "?"}）`));
        });
    });
}

function depsReady(): { root: boolean; web: boolean } {
    return {
        root: existsSync(join(ROOT, "node_modules", "express")),
        web: existsSync(join(ROOT, "web", "node_modules", "express")),
    };
}

async function ensureDependencies(skipInstall: boolean): Promise<void> {
    heading("依赖检查");
    const ready = depsReady();
    const needRoot = !ready.root;
    const needWeb = !ready.web;

    if (!needRoot && !needWeb) {
        ok("Bot 与 Web 面板依赖均已安装");
        return;
    }
    if (skipInstall) {
        bad(`依赖缺失（Bot: ${needRoot ? "缺" : "有"}，Web: ${needWeb ? "缺" : "有"}），但已指定 --skip-install`);
        throw new Error("依赖不完整");
    }

    if (needRoot) {
        note("安装 Bot 依赖（npm install）...");
        await npmRun(["install"], ROOT);
        ok("Bot 依赖安装完成");
    }
    if (needWeb) {
        note("安装 Web 面板依赖（web/ 下 npm install）...");
        await npmRun(["install"], join(ROOT, "web"));
        ok("Web 面板依赖安装完成");
    }
}

type PortState = "free" | "busy";

function probePort(port: number): Promise<PortState> {
    return new Promise<PortState>((resolveProbe) => {
        const server = createServer();
        server.once("error", () => resolveProbe("busy"));
        server.once("listening", () => server.close(() => resolveProbe("free")));
        server.listen({ port, host: "127.0.0.1", exclusive: true });
    });
}

interface PortReport {
    wsPort: number;
    webPort: number;
    bffPort: number;
    wsBusy: boolean;
    webBusy: boolean;
    bffBusy: boolean;
    napcatListening: boolean;
}

async function inspectPorts(wsPort: number, webPort: number, bffPort: number, napcatHost: string): Promise<PortReport> {
    const napcatPort = Number(napcatHost.split(":").pop() ?? 3000);
    const [ws, web, bff, napcat] = await Promise.all([
        probePort(wsPort),
        probePort(webPort),
        probePort(bffPort),
        probePort(Number.isInteger(napcatPort) ? napcatPort : 3000),
    ]);
    return {
        wsPort,
        webPort,
        bffPort,
        wsBusy: ws === "busy",
        webBusy: web === "busy",
        bffBusy: bff === "busy",
        // NapCat 的 HTTP 端口本该有人监听，busy 才是正常
        napcatListening: napcat === "busy",
    };
}

function reportPorts(report: PortReport, napcatHost: string): void {
    heading("端口检查");

    if (report.wsBusy) {
        warn(`${report.wsPort} 已被占用：若已有 Cith 在运行，请先停掉再启动`);
    }
    else {
        ok(`${report.wsPort} 空闲（NapCat 反向 WebSocket 将监听此端口）`);
    }

    if (report.webBusy) {
        warn(`${report.webPort} 已被占用：面板 API 可能无法启动`);
    }
    else {
        ok(`${report.webPort} 空闲（Bot 面板 API，仅本机）`);
    }

    if (report.bffBusy) {
        warn(`${report.bffPort} 已被占用：面板 BFF 可能无法启动`);
    }
    else {
        ok(`${report.bffPort} 空闲（Web 面板 BFF）`);
    }

    if (report.napcatListening) {
        ok(`NapCat HTTP ${napcatHost} 正在监听`);
    }
    else {
        warn(`未检测到 NapCat HTTP 服务（${napcatHost}）：NapCat 未启动时反向 WS 不会连入`);
        note("NapCat 启动后，在其 WebUI 添加反向 WebSocket，地址见下方启动摘要");
    }
}

// ===== 配置加载校验（真跑一次 config.js，而不是猜） =====

interface ConfigSnapshot {
    devMode: boolean;
    wsPort: number;
    webPort: number;
    webPath: string;
    webToken: string;
    owner: string;
    selfId: string;
    aiApiKey: string;
    chatModel: string;
    napcatHost: string;
    targetGroupId: string[];
    targetUserId: string[];
}

const MARKER = "__SETUP_SNAPSHOT__";

async function loadConfigSnapshot(): Promise<ConfigSnapshot> {
    const configUrl = pathToFileURL(CONFIG_JS).href;
    const code = [
        `import(${JSON.stringify(configUrl)}).then((m) => {`,
        "  const c = m.default;",
        `  console.log(${JSON.stringify(MARKER)} + JSON.stringify({`,
        "    devMode: c.devMode === true,",
        "    wsPort: c.wsPort,",
        "    webPort: c.web?.port,",
        "    webPath: c.web?.path,",
        "    webToken: c.web?.token,",
        "    owner: c.owner,",
        "    selfId: c.selfId,",
        "    aiApiKey: c.aiApiKey,",
        "    chatModel: c.chatModel,",
        "    napcatHost: c.napcatHttpHost,",
        "    targetGroupId: c.targetGroupId ?? [],",
        "    targetUserId: c.targetUserId ?? [],",
        "  }));",
        "}).catch((e) => { console.error(e); process.exit(1); });",
    ].join("\n");

    try {
        const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", code], {
            cwd: ROOT,
            timeout: 30000,
            maxBuffer: 4 * 1024 * 1024,
        });
        const line = stdout.split(/\r?\n/).find((item) => item.startsWith(MARKER));
        if (!line) throw new Error("配置校验子进程没有返回结果");
        return JSON.parse(line.slice(MARKER.length)) as ConfigSnapshot;
    }
    catch (err) {
        const detail = err as { stderr?: string; stdout?: string; message?: string };
        bad("配置无法加载（Bot 启动时同样会失败），下面是原始报错：");
        const output = (detail.stderr || detail.stdout || detail.message || "").trim();
        if (output) say(dim(output.split(/\r?\n/).map((l) => `    ${l}`).join("\n")));
        throw new Error("配置校验未通过");
    }
}

function looksPlaceholder(value: unknown): boolean {
    if (typeof value !== "string") return false;
    const text = value.trim();
    return text === "" || /^your_/i.test(text);
}

function isBlankList(value: unknown): boolean {
    if (!Array.isArray(value) || value.length === 0) return true;
    return value.every((item) => looksPlaceholder(item));
}

function reportConfig(snapshot: ConfigSnapshot, env: Record<string, string> | null): void {
    heading("配置校验");
    ok("core/config.js + configDev.js 可正常加载");

    if (looksPlaceholder(snapshot.owner)) bad("owner 未填写：所有管理指令都会返回无权限");
    else ok("owner 已填写");

    if (looksPlaceholder(snapshot.aiApiKey)) bad("aiApiKey 未填写：AI 无法生成回复");
    else ok(`模型：${snapshot.chatModel}`);

    if (isBlankList(snapshot.targetGroupId) && isBlankList(snapshot.targetUserId)) {
        warn("会话白名单为空：启动后到目标群里 @机器人 发送 #bind 绑定当前会话");
    }
    else {
        const groups = [snapshot.targetGroupId].flat().filter((v) => !looksPlaceholder(v)).length;
        const users = [snapshot.targetUserId].flat().filter((v) => !looksPlaceholder(v)).length;
        ok(`会话白名单：${groups} 个群 / ${users} 个私聊`);
    }

    if (!env) {
        warn("web/.env 不存在：面板 BFF 无法启动（可用本脚本生成）");
        return;
    }

    const envUrl = env.BOT_API_URL ?? "";
    const expected = `ws://127.0.0.1:${snapshot.webPort}${snapshot.webPath}`;
    if (envUrl === expected) ok("web/.env 的 BOT_API_URL 与 Bot 面板端口一致");
    else warn(`web/.env 的 BOT_API_URL 与 Bot 不一致：应为 ${expected}`);

    if ((env.BOT_API_TOKEN ?? "") === String(snapshot.webToken)) ok("web/.env 的 BOT_API_TOKEN 与 Bot 一致");
    else warn("web/.env 的 BOT_API_TOKEN 与 Bot 的 web.token 不一致：面板会鉴权失败");

    if ((env.WEB_PASSWORD ?? "") === "") {
        warn("web/.env 未设置 WEB_PASSWORD：面板登录未启用，可能被同网段任何人打开");
    }
}

// ===== 问卷 =====

function isQQ(value: string): string | null {
    return /^\d{5,12}$/.test(value) ? null : "请输入 5-12 位数字 QQ 号";
}

function isHttpUrl(value: string): string | null {
    return /^https?:\/\/\S+$/i.test(value) ? null : "请输入 http(s):// 开头的完整地址";
}

async function collectAnswers(p: Prompter): Promise<SetupAnswers> {
    heading("机器人身份");
    const owner = await p.ask("管理员 QQ 号（owner，接收管理指令）", { required: true, validate: isQQ });
    const selfId = await p.ask("机器人自身 QQ 号（selfId）", { required: true, validate: isQQ });
    const groupRaw = await p.ask("初始群号（可留空，之后在群里发 #bind 自动绑定）", {});
    const userRaw = await p.ask("初始私聊用户 QQ（可留空，对方首次发消息后发 #bind）", {});
    const targetGroupId = parseIdList(groupRaw);
    const targetUserId = parseIdList(userRaw);
    if (targetGroupId.length === 0 && targetUserId.length === 0) {
        note("先留空也可以：启动后让机器人在群里 @ 它并发送 #bind");
    }

    heading("模型（OpenAI 兼容协议）");
    const llmApiUrl = await p.ask("文本模型 API 地址", { default: DEFAULT_LLM_URL, validate: isHttpUrl });
    const aiApiKey = await p.ask("文本模型 API Key", { required: true, secret: true });
    const chatModel = await p.ask("聊天模型名称", { default: DEFAULT_CHAT_MODEL });
    const reuseVision = await p.confirm("识图能力复用文本模型的地址与 Key？", true);

    let llmVisionApiUrl = llmApiUrl;
    let visionApiKey = aiApiKey;
    let visionModel = chatModel;
    if (!reuseVision) {
        llmVisionApiUrl = await p.ask("视觉模型 API 地址", { default: llmApiUrl, validate: isHttpUrl });
        visionApiKey = await p.ask("视觉模型 API Key", { required: true, secret: true });
        visionModel = await p.ask("识图模型名称", { default: chatModel });
    }

    heading("长期记忆（可选，rememori + 本地 Ollama）");
    const enableLongTermMemory = await p.confirm("启用本地长期记忆？", false);
    let memoryOllamaUrl = "http://localhost:11434";
    let memoryEmbedModel = "bge-m3";
    if (enableLongTermMemory) {
        note("需先安装 Ollama，并执行：ollama pull bge-m3（中文场景建议这个模型）");
        memoryOllamaUrl = await p.ask("Ollama 服务地址", {
            default: "http://localhost:11434",
            validate: isHttpUrl,
        });
        memoryEmbedModel = await p.ask("embedding 模型名", { default: "bge-m3" });
    }

    heading("QQ 接入（NapCat）");
    note("NapCat 与 Bot 同机时，反向 WS 用 127.0.0.1 即可，无需放行防火墙");
    const napcatHttpHost = await p.ask("NapCat HTTP 地址", { default: DEFAULT_NAPCAT_HTTP });
    const napcatToken = await p.ask("NapCat HTTP 鉴权 token（没设就留空）", { secret: true });
    const wsPort = await p.askPort("反向 WebSocket 端口", DEFAULT_WS_PORT);

    heading("Web 面板");
    const webPort = await p.askPort("Bot 面板 API 端口", DEFAULT_WEB_PORT);
    const generatedToken = randomBytes(12).toString("hex");
    const webToken = await p.ask("面板连接 token（回车由脚本随机生成）", {
        default: generatedToken,
        secret: true,
        validate: (v) => (v.length >= 8 ? null : "至少 8 个字符"),
    });
    const bffPort = await p.askPort("Web 面板 BFF 端口", DEFAULT_BFF_PORT);
    const webPassword = await p.ask("浏览器登录密码（留空则不设登录，不推荐）", {});
    const sslEnabled = await p.confirm("启用 HTTPS（自签名证书，首次访问需信任一次）？", false);
    const serverIp = sslEnabled ? await p.ask("写进证书的公网 IP（留空则只含本机）", {}) : "";

    return {
        owner, selfId, targetGroupId, targetUserId,
        llmApiUrl, aiApiKey, chatModel,
        llmVisionApiUrl, visionApiKey, visionModel,
        enableLongTermMemory, memoryOllamaUrl, memoryEmbedModel,
        wsPort, napcatHttpHost, napcatToken,
        webPort, webToken, bffPort, webPassword, sslEnabled, serverIp,
    };
}

// ===== 写文件 =====

function backupIfExists(path: string): string | null {
    if (!existsSync(path)) return null;
    const target = `${path}.bak.${Date.now()}`;
    copyFileSync(path, target);
    return target;
}

function writeSecretFile(path: string, content: string): void {
    writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
    try {
        chmodSync(path, 0o600);
    }
    catch {
        // Windows 上 chmod 语义有限，忽略
    }
}

function writeConfigDev(answers: SetupAnswers): void {
    heading("写入配置");
    if (existsSync(CONFIG_DEV)) {
        const backup = backupIfExists(CONFIG_DEV);
        if (backup) warn(`旧 core/configDev.js 已备份为 ${backup.slice(ROOT.length + 1)}`);
        else warn("旧 core/configDev.js 备份失败，将被直接覆盖");
    }
    writeSecretFile(CONFIG_DEV, buildConfigDevSource(answers));
    ok("core/configDev.js 已写入（密钥仅本机可见）");
}

function writeWebEnv(answers: SetupAnswers): void {
    const values = buildEnvValues(answers);
    if (existsSync(WEB_ENV)) {
        const existing = readFileSync(WEB_ENV, "utf8");
        const merged = mergeEnvText(existing, values);
        if (merged === `${existing.replace(/\n*$/, "")}\n`) {
            ok("web/.env 已是目标值，无需改动");
            return;
        }
        const backup = backupIfExists(WEB_ENV);
        if (backup) note(`旧 .env 备份：${backup.slice(ROOT.length + 1)}`);
        writeSecretFile(WEB_ENV, merged);
        ok("web/.env 已更新（BOT_API_TOKEN 与 Bot 自动对齐）");
        return;
    }
    writeSecretFile(WEB_ENV, buildEnvTemplate(values));
    ok("web/.env 已生成（BOT_API_TOKEN 与 Bot 自动对齐）");
}

// ===== 面板构建 =====

async function ensureWebBuild(p: Prompter): Promise<void> {
    heading("Web 面板");
    if (existsSync(WEB_DIST)) {
        ok("检测到已构建的 web/dist，跳过构建");
        return;
    }
    const build = await p.confirm("尚未构建 Web 面板（直接访问端口会 404），现在构建？", true);
    if (!build) {
        warn("跳过构建：面板页面暂不可用，Bot 与 #bind 不受影响");
        return;
    }
    note("构建中（tsc + vite，约 1-2 分钟）...");
    await npmRun(["run", "build:web"], ROOT);
    ok("Web 面板构建完成（浏览器请访问 BFF 端口，不是 Bot 面板端口）");
}

// ===== 启动 =====

function localIPv4(): string[] {
    const out: string[] = [];
    for (const list of Object.values(networkInterfaces())) {
        for (const item of list ?? []) {
            if (item.family === "IPv4" && !item.internal) out.push(item.address);
        }
    }
    return out;
}

function printStartSummary(snapshot: ConfigSnapshot, env: Record<string, string>): void {
    const bffPort = env.WEB_PORT ?? String(DEFAULT_BFF_PORT);
    const scheme = env.WEB_SSL_ENABLED === "true" ? "https" : "http";
    const wsUrl = `ws://127.0.0.1:${snapshot.wsPort}/onebot/v11/ws`;
    const lanWs = localIPv4().map((ip) => `ws://${ip}:${snapshot.wsPort}/onebot/v11/ws`);

    say("");
    say(bold("────────────────────────────────────────────"));
    say(`${bold("NapCat 反向 WebSocket")}（NapCat WebUI → 网络配置 → 添加）`);
    say(`  ${green(wsUrl)}`);
    for (const url of lanWs) say(dim(`  局域网备选：${url}`));
    say("");
    say(`${bold("管理面板")}`);
    say(`  本机：${green(`${scheme}://127.0.0.1:${bffPort}`)}`);
    say(dim("  远程：ssh -L " + bffPort + ":127.0.0.1:" + bffPort + " 用户@服务器 后在本地打开上面的地址"));
    say("");
    say(`${bold("绑定会话")}`);
    say("  在目标群里 @机器人 发送 #bind（私聊直接发 #bind），无需手抄群号");
    say(bold("────────────────────────────────────────────"));
    say("");
}

async function startBot(snapshot: ConfigSnapshot, env: Record<string, string>): Promise<void> {
    printStartSummary(snapshot, env);
    note("正在启动：node core/index.js（Ctrl+C 停止）");
    say("");

    const child = spawn(process.execPath, ["core/index.js"], {
        cwd: ROOT,
        stdio: ["inherit", "pipe", "pipe"],
    });

    let apiReady = false;
    let onebotReady = false;
    let napcatReady = false;
    let summaryShown = false;
    let interrupted = false;

    const showReady = (): void => {
        if (summaryShown || !apiReady || !onebotReady) return;
        summaryShown = true;
        const bffPort = env.WEB_PORT ?? String(DEFAULT_BFF_PORT);
        const scheme = env.WEB_SSL_ENABLED === "true" ? "https" : "http";
        say("");
        ok(`服务已就绪：面板 ${scheme}://127.0.0.1:${bffPort}`);
        if (napcatReady) ok("NapCat 已连接，可以开始对话");
        else warn("等待 NapCat 连入：确认 NapCat 已填入上面的反向 WS 地址");
        say("");
    };

    const relay = (chunk: Buffer, target: NodeJS.WriteStream): void => {
        target.write(chunk);
        const text = chunk.toString("utf8");
        if (!apiReady && text.includes("面板 API 服务已启动")) {
            apiReady = true;
            showReady();
        }
        if (!onebotReady && text.includes("OnebotWebSocket 服务已启动")) {
            onebotReady = true;
            showReady();
        }
        if (!napcatReady && text.includes("NapCat 已连接")) {
            napcatReady = true;
            showReady();
        }
    };

    child.stdout?.on("data", (chunk: Buffer) => relay(chunk, process.stdout));
    child.stderr?.on("data", (chunk: Buffer) => relay(chunk, process.stderr));

    const stop = (): void => {
        interrupted = true;
        child.kill("SIGINT");
        setTimeout(() => {
            if (child.exitCode === null) child.kill();
        }, 5000).unref();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);

    await new Promise<void>((resolveExit) => {
        child.on("error", (err) => {
            bad(`启动失败：${err.message}`);
            resolveExit();
        });
        child.on("exit", (code, signal) => {
            if (!interrupted && code !== 0) {
                say("");
                bad(`进程退出（code=${code ?? "null"}${signal ? `, signal=${signal}` : ""}）`);
                note("排查：看上方第一批 [ERROR] 日志；配置问题可用 npm run setup -- --check");
            }
            process.exitCode = interrupted ? 130 : (code ?? 0);
            resolveExit();
        });
    });
}

// ===== 只读检查 =====

async function runCheck(): Promise<void> {
    const snapshot = await loadConfigSnapshot();
    const env = existsSync(WEB_ENV) ? parseEnvText(readFileSync(WEB_ENV, "utf8")) : null;
    reportConfig(snapshot, env);

    const report = await inspectPorts(snapshot.wsPort, snapshot.webPort, Number(env?.WEB_PORT ?? DEFAULT_BFF_PORT), snapshot.napcatHost);
    reportPorts(report, snapshot.napcatHost);

    heading("面板构建");
    if (existsSync(WEB_DIST)) ok("web/dist 已构建");
    else warn("web/dist 未构建：npm run build:web（或用本脚本正常运行来构建）");

    say("");
    ok("检查完成（未做任何修改）");
}

// ===== 入口 =====

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

async function main(): Promise<void> {
    const flags = parseFlags(process.argv.slice(2));
    if (flags.help) {
        printHelp();
        return;
    }

    assertProjectRoot();
    say(bold("\nCith 一键初始化"));

    checkNode();
    checkDevMode(!flags.check);
    await ensureDependencies(flags.skipInstall);

    if (flags.check) {
        await runCheck();
        return;
    }

    const p = new Prompter();
    let answers: SetupAnswers | null = null;

    if (existsSync(CONFIG_DEV) && !flags.force) {
        const reuse = await p.confirm("检测到 core/configDev.js：保持现有配置，只做校验与启动？", true);
        if (!reuse) answers = await collectAnswers(p);
    }
    else {
        answers = await collectAnswers(p);
    }

    if (answers) {
        writeConfigDev(answers);
        writeWebEnv(answers);
    }
    else {
        heading("配置文件");
        ok("沿用现有 core/configDev.js");
    }

    const snapshot = await loadConfigSnapshot();
    const env = existsSync(WEB_ENV) ? parseEnvText(readFileSync(WEB_ENV, "utf8")) : null;
    reportConfig(snapshot, env);
    if (!env) throw new Error("web/.env 缺失：请重新运行并选择重新配置");

    const report = await inspectPorts(snapshot.wsPort, snapshot.webPort, Number(env.WEB_PORT ?? DEFAULT_BFF_PORT), snapshot.napcatHost);
    reportPorts(report, snapshot.napcatHost);

    await ensureWebBuild(p);

    if (flags.noStart) {
        printStartSummary(snapshot, env);
        ok("已按 --no-start 跳过启动");
        return;
    }

    await startBot(snapshot, env);
}

if (isMain) {
    main().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        say("");
        if (message === "__CANCEL__") {
            say(yellow("已取消，未做任何修改。"));
            process.exitCode = 130;
            return;
        }
        bad(message);
        process.exitCode = 1;
    });
}