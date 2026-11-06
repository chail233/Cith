/**
 * 开发用表情包入库脚本
 *
 * 把一个文件夹里的表情包图片交给多模态模型，生成画面描述后写入
 * core/stickers/manifest.dev.json（开发索引）或 core/stickers/manifest.json（生产索引）。
 *
 * 用法：node scripts/add-stickers.js <图片文件夹> [--target dev|prod]
 *       [--force] [--dry] [--concurrency N]
 */

import { createHash } from "node:crypto";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    renameSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import axios from "axios";
import config from "../core/config.js";
import getImageType from "../core/utils/image-type.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const coreDir = resolve(root, "core");
/** 表情包根目录，与 manifest 的 baseDir 对应 */
const imagesDir = resolve(coreDir, "stickers", "images");
/** manifest.baseDir 的固定值，与运行时 resolveSrcPath 的基准保持一致 */
const BASE_DIR = "stickers/images";

/** 目标索引路径 */
/** @type {Record<"dev" | "prod", string>} */
const MANIFEST_PATHS = {
    dev: resolve(coreDir, "stickers", "manifest.dev.json"),
    prod: resolve(coreDir, "stickers", "manifest.json"),
};

/**
 * 视觉模型 API 配置
 * 直接在这里填好即可独立运行；留空则依次回退到
 * 环境变量 STICKER_API_URL / STICKER_API_KEY / STICKER_API_MODEL
 * 和 core/config.js 里的视觉模型配置
 */
/** @type {{ url: string, key: string, model: string }} */
const VISION_API = {
    url: "",
    key: "",
    model: "",
};

/** 支持的图片扩展名（实际类型以魔数为准） */
const SUPPORTED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
/** 图片魔数类型 → MIME */
/** @type {Record<string, string>} */
const MIME = {
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
};

const MAX_DESC_LEN = 100;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1200;
const API_TIMEOUT = 90_000;
const DEFAULT_CONCURRENCY = 3;

const SYSTEM_PROMPT = `你是一名表情包标注员，负责给聊天表情包写「入库标注」。
你会收到一张表情包图片，请按要求只输出一个 JSON 对象。

输出格式（严格遵守，只输出 JSON 本体）：
{"desc": "画面 + 情绪 + 适用场景的一句话描述"}

标注规则：
1. desc 控制在 30～70 个汉字，按「画面 → 情绪/场景」顺序写成一句自然的中文：画面里是谁或什么、在做什么表情动作、适合在什么聊天情境下使用。不要分点，不要用"这张图""该表情包"开头。
2. 若图上有配文、字幕或梗文字，必须把文字内容及其语气写进 desc；水印、平台 Logo、聊天气泡等界面元素忽略。
3. 用词具体、口语化，让人不看图也能想象出画面，并与其他表情包明确区分开；不要堆形容词，不写"非常可爱""很有趣"这类空泛评价。
4. 不要描述背景颜色、构图、分辨率、画质等与聊天使用无关的信息；不要输出色情、暴力、人身攻击类内容。
5. 输出必须能被 JSON.parse 直接解析，不要加代码块、注释或任何解释文字。`;

const USAGE = `表情包入库脚本（开发用）

用法：
  node scripts/add-stickers.js <图片文件夹> [选项]

选项：
  --target dev|prod  写入哪个索引，默认跟随运行时选索引逻辑
                     （本地存在 manifest.dev.json 时用 dev，否则 prod）
                     dev  -> core/stickers/manifest.dev.json
                     prod -> core/stickers/manifest.json
  --force            索引里已存在的图片重新标注并覆盖
  --dry              只请求模型并打印结果，不写索引、不拷贝图片
  --concurrency N    并发请求数，默认 ${DEFAULT_CONCURRENCY}
  -h, --help         显示本帮助
`;

/**
 * @typedef {Object} Options
 * @property {string} folder 源图片文件夹
 * @property {"" | "dev" | "prod"} target 目标索引
 * @property {boolean} force 是否覆盖已有条目
 * @property {boolean} dry 是否只试跑
 * @property {number} concurrency 并发数
 * @property {boolean} help 是否只打印帮助
 */

/**
 * @typedef {Object} StickerItem
 * @property {string} id
 * @property {string} file 相对 baseDir 的路径，统一用 /
 * @property {string} desc
 */

/**
 * @typedef {Object} StickerManifest
 * @property {number} version
 * @property {string} baseDir
 * @property {StickerItem[]} items
 */

/**
 * @typedef {Object} Placement
 * @property {string} sourceFile 源文件绝对路径
 * @property {string} destPath 目标文件绝对路径
 * @property {string} fileRef 写入 manifest 的相对路径
 * @property {boolean} needsCopy 是否需要拷贝
 */

/**
 * @typedef {Object} Annotation
 * @property {string} desc
 * @property {number} tokens
 */

/**
 * @typedef {{ kind: "skip", fileRef: string, placement: Placement }
 *   | { kind: "fail", fileRef: string, error: string }
 *   | { kind: "ready", fileRef: string, placement: Placement, existing: number | undefined, annotation: Annotation }} TaskResult
 */

/**
 * 解析命令行参数
 * @param {string[]} argv
 * @returns {Options}
 */
function parseArgs(argv) {
    /** @type {Options} */
    const opts = {
        folder: "",
        target: "",
        force: false,
        dry: false,
        concurrency: DEFAULT_CONCURRENCY,
        help: false,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        switch (arg) {
            case "-h":
            case "--help":
                opts.help = true;
                return opts;
            case "--target": {
                const value = argv[i += 1];
                if (value !== "dev" && value !== "prod")
                    throw new Error(`--target 只能是 dev 或 prod，收到：${value ?? "(空)"}`);
                opts.target = value;
                break;
            }
            case "--concurrency": {
                const raw = argv[i += 1];
                const value = Number(raw);
                if (!Number.isInteger(value) || value <= 0)
                    throw new Error(`--concurrency 需要正整数，收到：${raw ?? "(空)"}`);
                opts.concurrency = value;
                break;
            }
            case "--force":
                opts.force = true;
                break;
            case "--dry":
                opts.dry = true;
                break;
            default:
                if (arg.startsWith("--"))
                    throw new Error(`未知参数：${arg}`);
                if (opts.folder)
                    throw new Error(`只能指定一个图片文件夹，收到多余参数：${arg}`);
                opts.folder = arg;
        }
    }

    return opts;
}

/**
 * 解析视觉模型 API 配置
 * @returns {{ url: string, key: string, model: string }}
 */
function resolveApiConfig() {
    const url = VISION_API.url || process.env.STICKER_API_URL || config.llmVisionApiUrl;
    const key = VISION_API.key || process.env.STICKER_API_KEY || config.visionApiKey;
    const model = VISION_API.model || process.env.STICKER_API_MODEL || config.visionModel;

    if (!url || !key || !model)
        throw new Error("视觉模型 API 未配置完整：请填写脚本顶部 VISION_API，或设置 STICKER_API_URL / STICKER_API_KEY / STICKER_API_MODEL");

    if (typeof key === "string" && (key.startsWith("your_") || key === "your_vision_api_key"))
        throw new Error("视觉模型 API Key 还是占位值，请先填写真实 Key");

    return { url, key, model };
}

/**
 * 递归列出文件夹内所有受支持的图片
 * @param {string} dir
 * @returns {string[]}
 */
function listImageFiles(dir) {
    /** @type {string[]} */
    const files = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listImageFiles(fullPath));
            continue;
        }
        if (entry.isFile() && SUPPORTED_EXT.has(extname(entry.name).toLowerCase()))
            files.push(fullPath);
    }
    return files.sort((a, b) => a.localeCompare(b));
}

/**
 * 判断 child 是否位于 parent 目录内（含相等）
 * @param {string} parent
 * @param {string} child
 * @returns {boolean}
 */
function isInside(parent, child) {
    const rel = relative(parent, child);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * 把文件名清洗成可用的目录名
 * @param {string} name
 * @returns {string}
 */
function safeFolderName(name) {
    const cleaned = name
        // eslint-disable-next-line no-control-regex
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/^\.+/, "")
        .trim();
    return cleaned || "stickers";
}

/**
 * 绝对路径 → manifest 里的相对路径（统一 /）
 * @param {string} fullPath
 * @returns {string}
 */
function toFileRef(fullPath) {
    return relative(imagesDir, fullPath).split(sep).join("/");
}

/**
 * 两个文件内容是否相同（表情包体积小，直接整文件哈希）
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function sameFile(a, b) {
    return fileHash(a) === fileHash(b);
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function fileHash(filePath) {
    return createHash("sha1").update(readFileSync(filePath)).digest("hex");
}

/**
 * 目标位置已被占用时：内容相同则复用，不同则加 -2/-3 后缀，避免覆盖已有图
 * @param {string} sourceFile
 * @param {string} target
 * @returns {{ destPath: string, needsCopy: boolean }}
 */
function findFreePath(sourceFile, target) {
    if (!existsSync(target))
        return { destPath: target, needsCopy: true };
    if (sameFile(sourceFile, target))
        return { destPath: target, needsCopy: false };

    const ext = extname(target);
    const stem = target.slice(0, target.length - ext.length);
    for (let index = 2; index <= 999; index += 1) {
        const candidate = `${stem}-${index}${ext}`;
        if (!existsSync(candidate))
            return { destPath: candidate, needsCopy: true };
        if (sameFile(sourceFile, candidate))
            return { destPath: candidate, needsCopy: false };
    }
    throw new Error(`同名文件过多，无法落盘：${target}`);
}

/**
 * 计算源图片在 images 目录中的最终位置（不落盘）
 * @param {string} sourceFile
 * @param {string} sourceRoot
 * @returns {Placement}
 */
function planPlacement(sourceFile, sourceRoot) {
    if (isInside(imagesDir, sourceFile))
        return { sourceFile, destPath: sourceFile, fileRef: toFileRef(sourceFile), needsCopy: false };

    const folderName = safeFolderName(basename(sourceRoot));
    const target = resolve(imagesDir, folderName, relative(sourceRoot, sourceFile));
    if (!isInside(imagesDir, target))
        throw new Error(`目标路径越界：${target}`);

    const free = findFreePath(sourceFile, target);
    return {
        sourceFile,
        destPath: free.destPath,
        fileRef: toFileRef(free.destPath),
        needsCopy: free.needsCopy,
    };
}

/**
 * 按计划把源图片拷贝到 images 目录
 * @param {Placement} placement
 */
function materialize(placement) {
    if (!placement.needsCopy)
        return;
    mkdirSync(dirname(placement.destPath), { recursive: true });
    copyFileSync(placement.sourceFile, placement.destPath);
}

/**
 * 读取目标 manifest，条目字段做一次宽松归一化
 * @param {string} manifestPath
 * @returns {StickerManifest}
 */
function readManifest(manifestPath) {
    if (!existsSync(manifestPath)) {
        console.warn(`[add-stickers] 索引不存在，将新建：${relative(root, manifestPath)}`);
        return { version: 1, baseDir: BASE_DIR, items: [] };
    }

    /** @type {any} */
    let raw;
    try {
        raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    }
    catch (err) {
        throw new Error(`索引解析失败（${relative(root, manifestPath)}）：${errorMessage(err)}`);
    }

    if (!raw || typeof raw !== "object" || !Array.isArray(raw.items))
        throw new Error(`索引格式不合法（缺少 items 数组）：${relative(root, manifestPath)}`);

    const items = raw.items
        .filter((item) => item && typeof item.id === "string" && typeof item.file === "string")
        .map((item) => ({
            id: item.id,
            file: item.file,
            desc: typeof item.desc === "string" ? item.desc : "",
        }));

    return {
        version: Number.isInteger(raw.version) ? raw.version : 1,
        baseDir: typeof raw.baseDir === "string" && raw.baseDir.trim() ? raw.baseDir.trim() : BASE_DIR,
        items,
    };
}

/**
 * 原子写入 manifest：先写 tmp 再 rename，避免中断产生半截文件
 * @param {string} manifestPath
 * @param {StickerManifest} manifest
 */
function writeManifest(manifestPath, manifest) {
    const tmp = `${manifestPath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    renameSync(tmp, manifestPath);
}

/**
 * 由相对路径生成 id：cat/001.png → cat_001，冲突时追加 _2/_3
 * @param {string} fileRef
 * @param {Set<string>} usedIds
 * @returns {string}
 */
function buildId(fileRef, usedIds) {
    const stem = fileRef.replace(/\.[^./]+$/, "");
    const base = stem
        .split("/")
        .join("_")
        .replace(/[^\p{L}\p{N}_-]+/gu, "_")
        .replace(/^_+|_+$/g, "") || "sticker";
    let id = base;
    let index = 2;
    while (usedIds.has(id)) {
        id = `${base}_${index}`;
        index += 1;
    }
    usedIds.add(id);
    return id;
}

/**
 * @param {string} text
 * @returns {string} desc
 */
function parseAnnotation(text) {
    const jsonText = extractJsonText(text);
    /** @type {any} */
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    }
    catch {
        throw new Error(`模型输出不是合法 JSON：${text.slice(0, 120)}`);
    }

    const desc = cleanDesc(parsed?.desc);
    if (!desc)
        throw new Error("模型没有给出有效描述");

    return desc;
}

/**
 * 从可能带代码块或前后缀的回复里抠出 JSON 主体
 * @param {string} text
 * @returns {string}
 */
function extractJsonText(text) {
    const stripped = text.replace(/```(?:json)?/gi, "").trim();
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start === -1 || end <= start)
        throw new Error(`模型输出里找不到 JSON：${text.slice(0, 120)}`);
    return stripped.slice(start, end + 1);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanDesc(value) {
    if (typeof value !== "string")
        return "";
    let desc = value.replace(/\s+/g, " ").trim();
    desc = desc.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "").trim();
    desc = desc.replace(/[。．.]+$/, "").trim();
    if (desc.length > MAX_DESC_LEN) {
        desc = desc.slice(0, MAX_DESC_LEN);
        console.warn(`[add-stickers] 描述超过 ${MAX_DESC_LEN} 字，已截断`);
    }
    return desc;
}

/**
 * 提取模型回复文本（兼容 content 为字符串或分段数组）
 * @param {any} data
 * @returns {string}
 */
function extractContent(data) {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim())
        return content;
    if (Array.isArray(content)) {
        const joined = content
            .map((part) => {
                if (typeof part === "string")
                    return part;
                if (part && typeof part.text === "string")
                    return part.text;
                return "";
            })
            .join("");
        if (joined.trim())
            return joined;
    }
    throw new Error(`模型返回内容为空：${JSON.stringify(data).slice(0, 200)}`);
}

/**
 * 调用视觉模型给单张表情包生成标注
 * @param {{ url: string, key: string, model: string }} api
 * @param {string} imagePath
 * @param {string} categoryLabel
 * @returns {Promise<Annotation>}
 */
async function describeSticker(api, imagePath, categoryLabel) {
    const type = getImageType(imagePath);
    const mime = type ? MIME[type] : undefined;
    if (!mime)
        throw new Error(`无法识别的图片格式：${basename(imagePath)}`);

    const buffer = readFileSync(imagePath);
    if (buffer.length > MAX_FILE_BYTES)
        console.warn(`[add-stickers] 图片较大（${(buffer.length / 1024 / 1024).toFixed(1)}MB），可能超过模型限制：${basename(imagePath)}`);

    const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
    const payload = {
        model: api.model,
        temperature: 0.4,
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
                role: "user",
                content: [
                    { type: "image_url", image_url: { url: dataUrl } },
                    { type: "text", text: buildUserHint(categoryLabel) },
                ],
            },
        ],
    };

    /** @type {unknown} */
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
        try {
            const resp = await axios.post(api.url, payload, {
                timeout: API_TIMEOUT,
                headers: {
                    Authorization: `Bearer ${api.key}`,
                    "Content-Type": "application/json",
                },
            });
            const content = extractContent(resp.data);
            return {
                desc: parseAnnotation(content),
                tokens: Number(resp.data?.usage?.total_tokens) || 0,
            };
        }
        catch (err) {
            lastError = err;
            const message = errorMessage(err);
            if (attempt < MAX_RETRIES) {
                console.warn(`[add-stickers] 第 ${attempt} 次失败，重试：${basename(imagePath)} - ${message}`);
                await sleep(RETRY_BASE_DELAY * attempt);
            }
        }
    }
    throw new Error(errorMessage(lastError));
}

/**
 * 构造单张图片的附加提示（分类）
 * @param {string} categoryLabel
 * @returns {string}
 */
function buildUserHint(categoryLabel) {
    return [
        `所属分类：${categoryLabel}`,
        "请按系统要求输出这张表情包的标注 JSON。",
    ].join("\n");
}

/**
 * 以固定并发跑任务，结果按传入顺序返回
 * @template T
 * @param {Array<() => Promise<T>>} tasks
 * @param {number} concurrency
 * @returns {Promise<T[]>}
 */
async function runPool(tasks, concurrency) {
    /** @type {T[]} */
    const results = new Array(tasks.length);
    let cursor = 0;
    const workerCount = Math.max(1, Math.min(concurrency, tasks.length));

    const workers = Array.from({ length: workerCount }, async () => {
        while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= tasks.length)
                return;
            results[index] = await tasks[index]();
        }
    });

    await Promise.all(workers);
    return results;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise((done) => setTimeout(done, ms));
}

/**
 * 统一提取错误信息，axios 错误优先取接口返回的 error.message
 * @param {unknown} err
 * @returns {string}
 */
function errorMessage(err) {
    if (axios.isAxiosError(err)) {
        const detail = err.response?.data?.error?.message ?? err.message;
        return err.response?.status ? `HTTP ${err.response.status} ${detail}` : detail;
    }
    if (err instanceof Error)
        return err.message;
    return String(err);
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        console.log(USAGE);
        return;
    }
    if (!opts.folder)
        throw new Error(`缺少图片文件夹参数\n\n${USAGE}`);
    // 默认与运行时 resolveManifestPath 保持一致：dev 索引存在即优先
    if (!opts.target)
        opts.target = existsSync(MANIFEST_PATHS.dev) ? "dev" : "prod";

    const api = resolveApiConfig();
    const folder = resolve(opts.folder);
    if (!existsSync(folder) || !statSync(folder).isDirectory())
        throw new Error(`图片文件夹不存在：${folder}`);

    const sources = listImageFiles(folder);
    if (sources.length === 0)
        throw new Error(`文件夹里没有可用图片（支持 ${[...SUPPORTED_EXT].join(" ")}）：${folder}`);

    const manifestPath = MANIFEST_PATHS[opts.target];
    const manifest = readManifest(manifestPath);
    if (manifest.baseDir !== BASE_DIR)
        console.warn(`[add-stickers] 索引 baseDir 为 "${manifest.baseDir}"，脚本按 "${BASE_DIR}" 计算相对路径，请确认一致`);

    /** manifest 中 file → 下标 */
    const fileIndex = new Map(manifest.items.map((item, index) => [item.file, index]));

    console.log(`[add-stickers] 索引：${relative(root, manifestPath)}（${opts.target}）${opts.dry ? "  [dry-run]" : ""}`);
    console.log(`[add-stickers] 图片：${sources.length} 张，模型：${api.model}，并发：${opts.concurrency}`);

    const stats = { added: 0, replaced: 0, skipped: 0, failed: 0, tokens: 0 };
    let done = 0;

    /** @type {Array<() => Promise<TaskResult>>} */
    const tasks = sources.map((sourceFile) => async () => {
        let fileRef = "";
        try {
            const placement = planPlacement(sourceFile, folder);
            fileRef = placement.fileRef;

            const existing = fileIndex.get(fileRef);
            if (existing !== undefined && !opts.force) {
                console.log(`[add-stickers] 跳过（索引已有）：${fileRef}`);
                return { kind: "skip", fileRef, placement };
            }

            const annotation = await describeSticker(api, sourceFile, categoryLabel(fileRef, folder));
            return { kind: "ready", fileRef, placement, existing, annotation };
        }
        catch (err) {
            return { kind: "fail", fileRef: fileRef || relative(root, sourceFile), error: errorMessage(err) };
        }
        finally {
            done += 1;
            if (done % 5 === 0 || done === sources.length)
                console.log(`[add-stickers] 进度：${done}/${sources.length}`);
        }
    });

    const results = await runPool(tasks, opts.concurrency);

    // 结果按扫描顺序落库，保证 manifest 顺序稳定；拷贝也在这一步做，dry 不落盘
    const usedIds = new Set(manifest.items.map((item) => item.id));
    for (const result of results) {
        if (result.kind === "fail") {
            stats.failed += 1;
            console.error(`[add-stickers] 失败：${result.fileRef} - ${result.error}`);
            continue;
        }

        if (!opts.dry)
            materialize(result.placement);

        if (result.kind === "skip") {
            stats.skipped += 1;
            continue;
        }

        stats.tokens += result.annotation.tokens;
        /** @type {StickerItem} */
        const item = {
            id: result.existing !== undefined ? manifest.items[result.existing].id : buildId(result.fileRef, usedIds),
            file: result.fileRef,
            desc: result.annotation.desc,
        };

        if (result.existing !== undefined) {
            manifest.items[result.existing] = item;
            stats.replaced += 1;
            console.log(`[add-stickers] 覆盖 [${item.id}] ${item.desc}`);
        }
        else {
            manifest.items.push(item);
            fileIndex.set(result.fileRef, manifest.items.length - 1);
            stats.added += 1;
            console.log(`[add-stickers] 新增 [${item.id}] ${item.desc}`);
        }
    }

    console.log("");
    console.log(`[add-stickers] 完成：新增 ${stats.added}，覆盖 ${stats.replaced}，跳过 ${stats.skipped}，失败 ${stats.failed}，tokens ${stats.tokens}`);

    if (opts.dry) {
        console.log("[add-stickers] dry-run：未写入索引、未拷贝图片");
    }
    else if (stats.added + stats.replaced > 0) {
        writeManifest(manifestPath, manifest);
        console.log(`[add-stickers] 已写入：${relative(root, manifestPath)}`);
    }
    else {
        console.log("[add-stickers] 索引无变化，未写入");
    }

    if (stats.failed > 0)
        process.exitCode = 1;
}

/**
 * 分类标签：cat/001.png → cat；放在根目录则用源文件夹名
 * @param {string} fileRef
 * @param {string} sourceRoot
 * @returns {string}
 */
function categoryLabel(fileRef, sourceRoot) {
    const dir = dirname(fileRef.split("/").join(sep));
    if (dir === ".")
        return basename(sourceRoot);
    return dir.split(sep).join(" / ");
}

main().catch((err) => {
    console.error(`[add-stickers] ${errorMessage(err)}`);
    console.error("[add-stickers] 运行 node scripts/add-stickers.js --help 查看用法");
    process.exitCode = 1;
});
