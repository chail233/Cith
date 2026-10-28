/**
 * SunbatwoBot 面板 BFF（Browser ↔ BFF ↔ Bot）。
 *
 */
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import selfsigned from "selfsigned";
import { BotApiClient } from "./bot-client.mjs";

const PORT = Number(process.env.WEB_PORT ?? 2146);
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
/** HTTPS 开关：WEB_SSL_ENABLED=true 时以自签名证书对外提供 https（关闭时维持 http，本地开发零影响） */
const SSL_ENABLED = process.env.WEB_SSL_ENABLED === "true";
/** 写入证书 subjectAltName 的公网 IP（云 NAT 服务器无法可靠自动探测，需显式传入） */
const SERVER_IP = process.env.WEB_SERVER_IP ?? "";
/** 自签名证书落盘缓存目录：重启不换证书，浏览器信任一次即可长期使用 */
const SSL_DIR = path.resolve(SERVER_DIR, "../.ssl");
const BOT_WS_URL = process.env.BOT_API_URL ?? "ws://127.0.0.1:2145/api/v1/ws";
const BOT_PANEL_TOKEN = process.env.BOT_API_TOKEN ?? "114514";
/** SSE 心跳注释帧周期，防止中间层空闲超时断开 */
const SSE_HEARTBEAT_MS = 15_000;
/** 转发给 Bot 的 action 白名单（BFF 自身的安全门禁，与 Bot 端白名单独立） */
const FORWARDABLE_ACTIONS = new Set([
    "get_status", "get_config", "set_config", "get_logs", "list_actions",
]);

const logger = (level, msg) => {
    const line = `[bff] ${new Date().toISOString()} ${level.toUpperCase()} ${msg}`;
    if (level === "error") console.error(line); else console.log(line);
};

const bot = new BotApiClient({
    url: BOT_WS_URL,
    token: BOT_PANEL_TOKEN,
    log: logger,
});
bot.connect();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

/** 浏览器会话（内存态，BFF 重启后失效）：设置了 WEB_PASSWORD 时启用面板登录 */
const AUTH_ENABLED = Boolean(process.env.WEB_PASSWORD);
const sessions = new Set();

/** 从请求中提取会话 token：优先 Authorization: Bearer，兼容 SSE 的 ?token= 查询参数 */
function extractToken(req) {
    const header = req.headers.authorization ?? "";
    if (header.startsWith("Bearer ")) return header.slice(7);
    const queryToken = req.query?.token;
    return typeof queryToken === "string" ? queryToken : "";
}

app.post("/api/login", (req, res) => {
    if (!AUTH_ENABLED) {
        res.json({ status: "ok", data: { required: false } });
        return;
    }
    if (req.body?.password !== process.env.WEB_PASSWORD) {
        res.status(401).json({ status: "error", message: "密码错误" });
        return;
    }
    const token = crypto.randomBytes(24).toString("hex");
    sessions.add(token);
    res.json({ status: "ok", data: { required: true, token } });
});

app.get("/api/session", (req, res) => {
    if (!AUTH_ENABLED) {
        res.json({ status: "ok", data: { required: false, authed: true } });
        return;
    }
    const token = extractToken(req);
    res.json({ status: "ok", data: { required: true, authed: Boolean(token && sessions.has(token)) } });
});

/** /api/* 登录门禁（login/session/health 除外，health 供顶栏状态灯无凭证轮询） */
app.use("/api", (req, res, next) => {
    if (!AUTH_ENABLED || ["/login", "/session", "/health"].includes(req.path)) {
        next();
        return;
    }
    if (sessions.has(extractToken(req))) {
        next();
        return;
    }
    res.status(401).json({ status: "error", message: "未登录或会话已失效" });
});

/** 健康检查：BFF 自身状态 + Bot 连接状态 */
app.get("/api/health", (_req, res) => {
    res.json({
        bff: true,
        bot: { connected: bot.connected, authenticated: bot.authenticated },
        lastEventTs: bot.lastTs,
    });
});

/**
 * 通用 RPC 转发：浏览器 → BFF → Bot。
 * 白名单外的 action 一律 403，绝不透传执行。
 */
app.post("/api/rpc", async (req, res) => {
    const { action, params } = req.body ?? {};
    if (typeof action !== "string" || !FORWARDABLE_ACTIONS.has(action)) {
        res.status(403).json({ status: "error", message: `action 不在 BFF 转发白名单内: ${action}` });
        return;
    }
    if (!bot.connected || !bot.authenticated) {
        res.status(503).json({ status: "error", message: "Bot 未连接，请稍后重试" });
        return;
    }
    try {
        const data = await bot.call(action, params ?? {});
        res.json({ status: "ok", data });
    }
    catch (err) {
        // Bot 的业务错误（如 set_config 拒绝）以 200 + error 帧语义返回，便于前端区分展示
        res.json({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
});

/**
 * 事件流（SSE）：
 * - 连接建立时若带 Last-Event-ID 头（或 ?since=），先用 get_logs 补拉环形缓冲中的遗漏事件；
 * - 之后实时转发 Bot 推送的事件帧，SSE id 即事件 ts，浏览器 EventSource 重连时自动携带。
 */
app.get("/api/events", async (req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");

    let closed = false;
    // 事件名通过 data.event 字段携带而非 SSE 具名事件，前端无需预先注册监听器即可兼容未知事件名
    const send = (frame) => {
        if (closed) return;
        try {
            res.write(`id: ${frame.ts}\ndata: ${JSON.stringify(frame)}\n\n`);
        } catch { /* ignore */ }
    };
    const offEvent = bot.onEvent(send);
    const heartbeat = setInterval(() => {
        if (!closed) res.write(": ping\n\n");
    }, SSE_HEARTBEAT_MS);
    req.on("close", () => {
        closed = true;
        clearInterval(heartbeat);
        offEvent();
    });

    // 补拉：SSE 断线期间（或 BFF 重启后）浏览器错过的事件
    const since = Number(req.headers["last-event-id"] ?? req.query.since ?? 0);
    if (Number.isFinite(since) && since > 0) {
        try {
            const events = await bot.call("get_logs", { since, limit: 1000 });
            if (Array.isArray(events)) {
                for (const frame of events) send(frame);
            }
        }
        catch (err) {
            logger("warn", `SSE 补拉失败: ${err instanceof Error ? err.message : err}`);
        }
    }
});

/** 生产模式：托管前端构建产物，SPA 路由回退到 index.html */
const distDir = path.resolve(SERVER_DIR, "../dist");
if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.use((req, res, next) => {
        if (req.method !== "GET" || req.path.startsWith("/api/")) {
            next();
            return;
        }
        res.sendFile(path.join(distDir, "index.html"));
    });
    logger("info", `静态资源目录: ${distDir}`);
}

/**
 * 加载或生成自签名证书：优先复用 .ssl/ 下的落盘缓存；
 */
async function ensureSslMaterial() {
    fs.mkdirSync(SSL_DIR, { recursive: true });
    const keyPath = path.join(SSL_DIR, "key.pem");
    const certPath = path.join(SSL_DIR, "cert.pem");
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        logger("info", `复用已有自签名证书: ${SSL_DIR}`);
        return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
    }
    if (!SERVER_IP) {
        logger("warn", "未设置 WEB_SERVER_IP，证书 SAN 仅含 localhost/127.0.0.1，浏览器按 IP 访问时需手动信任");
    }
    const altNames = [
        { type: 2, value: "localhost" },
        { type: 7, ip: "127.0.0.1" },
    ];
    if (SERVER_IP) altNames.push({ type: 7, ip: SERVER_IP });
    const pems = await selfsigned.generate(
        [{ name: "commonName", value: SERVER_IP || "localhost" }],
        {
            keySize: 2048,
            notAfterDate: new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000),
            extensions: [{ name: "subjectAltName", altNames }],
        }
    );
    fs.writeFileSync(keyPath, pems.private);
    fs.writeFileSync(certPath, pems.cert);
    logger("info", `已生成自签名证书并落盘: ${SSL_DIR}`);
    return { key: pems.private, cert: pems.cert };
}

const server = SSL_ENABLED ? https.createServer(await ensureSslMaterial(), app) : http.createServer(app);
server.listen(PORT, () => {
    logger("info", `面板 BFF 开放在端口：${PORT} (${SSL_ENABLED ? "https" : "http"})`);
    logger("info", `Bot API: ${BOT_WS_URL}`);
});

async function shutdown() {
    logger("info", "正在关闭 BFF...");
    bot.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
