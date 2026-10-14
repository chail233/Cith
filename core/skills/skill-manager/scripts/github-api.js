/**
 * GitHub Skill 安装 API 封装
 * 从 GitHub 仓库下载并安装 Skill
 *
 * 设计意图：
 * - 作为 skill-manager 的内部模块，仅供本 skill 的脚本使用
 * - 使用 Node.js 原生 fetch，无需额外依赖
 * - 对 GitHub API 错误和速率限制做统一处理
 */

import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 加载项目配置，用于读取 GitHub Token
const configPath = resolve(__dirname, "..", "..", "..", "config.js");
const config = (await import(pathToFileURL(configPath).href)).default;

const GITHUB_API_BASE = "https://api.github.com";
const SKILLS_DIR = resolve(__dirname, "..", "..");

/**
 * 获取 GitHub Token
 * 从 config.githubToken 读取
 * @returns {string|undefined}
 */
function getGitHubToken() {
    return config.githubToken || undefined;
}

/**
 * 构建请求头
 * @returns {Record<string, string>}
 */
function buildHeaders() {
    const headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "SunbatwoBot-SkillManager",
    };
    const token = getGitHubToken();
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
}

/**
 * 统一的 GitHub API 请求处理
 * 设计意图：集中处理错误和速率限制
 * @param {string} url
 * @returns {Promise<any>}
 */
async function githubFetch(url) {
    const res = await fetch(url, { headers: buildHeaders() });

    if (res.status === 403) {
        const remaining = res.headers.get("x-ratelimit-remaining");
        if (remaining === "0") {
            const reset = res.headers.get("x-ratelimit-reset");
            const resetTime = new Date(Number(reset) * 1000).toLocaleString();
            throw new Error(`GitHub API 配额已用完，重置时间: ${resetTime}`);
        }
    }

    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`GitHub API 错误 ${res.status}: ${errorText}`);
    }

    return res.json();
}

/**
 * 解析 GitHub 仓库地址
 * 支持格式：
 *   - owner/repo
 *   - owner/repo/subdir
 *   - https://github.com/owner/repo
 *   - https://github.com/owner/repo/tree/main/subdir
 * @param {string} input
 * @returns {{owner: string, repo: string, subdir: string}}
 */
export function parseRepoUrl(input) {
    // 处理完整 URL
    if (input.startsWith("http://") || input.startsWith("https://")) {
        const url = new URL(input);
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length < 2) {
            throw new Error("无效的 GitHub URL");
        }
        const owner = parts[0];
        const repo = parts[1];
        // 处理 /tree/branch/subdir 格式
        let subdir = "";
        if (parts[2] === "tree" && parts.length > 4) {
            subdir = parts.slice(4).join("/");
        }
        return { owner, repo, subdir };
    }

    // 处理 owner/repo 或 owner/repo/subdir
    const parts = input.split("/");
    if (parts.length < 2) {
        throw new Error("无效的仓库地址，格式应为 owner/repo 或 owner/repo/subdir");
    }
    return {
        owner: parts[0],
        repo: parts[1],
        subdir: parts.slice(2).join("/"),
    };
}

/**
 * 从 SKILL.md 内容解析 frontmatter 元数据
 * @param {string} content
 * @returns {{name: string, description: string}}
 */
export function parseFrontmatter(content) {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return { name: "unknown", description: "无描述" };

    const fm = match[1];
    const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim() || "unknown";
    const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim() || "无描述";
    return { name, description };
}

/**
 * 探测 SKILL.md 位置
 * 设计意图：兼容多种仓库结构
 *   - 根目录: SKILL.md
 *   - 子目录: subdir/SKILL.md
 *   - 同名子目录: repo/repo/SKILL.md
 * @param {string} owner
 * @param {string} repo
 * @param {string} subdir
 * @returns {Promise<string>} SKILL.md 所在目录路径
 */
async function detectSkillPath(owner, repo, subdir) {
    const basePath = subdir || "";

    // 1. 尝试 basePath/SKILL.md
    try {
        const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${basePath}/SKILL.md`;
        await githubFetch(url);
        return basePath;
    }
    catch (err) {
        if (!err.message.includes("404")) throw err;
    }

    // 2. 尝试 basePath/repo/SKILL.md（同名嵌套）
    try {
        const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${basePath}/${repo}/SKILL.md`;
        await githubFetch(url);
        return `${basePath}/${repo}`.replace(/^\/+/, "");
    }
    catch (err) {
        if (!err.message.includes("404")) throw err;
    }

    // 3. 遍历 basePath 下的子目录
    try {
        const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${basePath}`;
        const entries = await githubFetch(url);
        if (Array.isArray(entries)) {
            for (const entry of entries) {
                if (entry.type === "dir") {
                    try {
                        const skillUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${basePath}/${entry.name}/SKILL.md`;
                        await githubFetch(skillUrl);
                        return `${basePath}/${entry.name}`.replace(/^\/+/, "");
                    }
                    catch {
                        // 继续尝试下一个
                    }
                }
            }
        }
    }
    catch {
        // 忽略
    }

    throw new Error("未找到 SKILL.md，请确认仓库地址是否正确");
}

/**
 * 递归获取目录下所有文件
 * @param {string} owner
 * @param {string} repo
 * @param {string} path
 * @returns {Promise<Array<{name: string, path: string, downloadUrl: string}>>}
 */
async function getAllFiles(owner, repo, path) {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}`;
    const entries = await githubFetch(url);

    if (!Array.isArray(entries)) {
        return [];
    }

    const files = [];
    for (const entry of entries) {
        if (entry.type === "file") {
            files.push({
                name: entry.name,
                path: entry.path,
                downloadUrl: entry.download_url,
            });
        }
        else if (entry.type === "dir") {
            const subFiles = await getAllFiles(owner, repo, entry.path);
            files.push(...subFiles);
        }
    }
    return files;
}

/**
 * 安装 Skill
 * @param {string} repoUrl 仓库地址
 * @returns {Promise<{name: string, description: string, path: string}>}
 */
export async function installSkill(repoUrl) {
    const { owner, repo, subdir } = parseRepoUrl(repoUrl);

    // 探测 SKILL.md 位置
    const skillPath = await detectSkillPath(owner, repo, subdir);

    // 获取 SKILL.md 内容
    const skillMdUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${skillPath}/SKILL.md`;
    const skillMdData = await githubFetch(skillMdUrl);
    const skillMdContent = Buffer.from(skillMdData.content, "base64").toString("utf-8");
    const meta = parseFrontmatter(skillMdContent);

    // 确定本地目录名（使用 SKILL.md 中的 name 或仓库名）
    const localName = meta.name !== "unknown" ? meta.name : repo;
    const localPath = join(SKILLS_DIR, localName);

    // 检查是否已存在
    if (existsSync(localPath)) {
        throw new Error(`技能 "${localName}" 已存在，如需重新安装请先卸载`);
    }

    // 获取所有文件
    const files = await getAllFiles(owner, repo, skillPath);

    // 创建本地目录并下载文件
    mkdirSync(localPath, { recursive: true });

    for (const file of files) {
        // 计算相对路径
        const relativePath = file.path.slice(skillPath.length).replace(/^\/+/, "");
        const localFilePath = join(localPath, relativePath);

        // 确保父目录存在
        const parentDir = dirname(localFilePath);
        if (!existsSync(parentDir)) {
            mkdirSync(parentDir, { recursive: true });
        }

        // 下载文件
        const res = await fetch(file.downloadUrl);
        const content = await res.text();
        writeFileSync(localFilePath, content, "utf-8");
    }

    return {
        name: meta.name,
        description: meta.description,
        path: localPath,
    };
}

/**
 * 卸载 Skill
 * @param {string} skillName 技能名称（目录名）
 * @returns {{name: string, path: string}}
 */
export function uninstallSkill(skillName) {
    const skillPath = join(SKILLS_DIR, skillName);

    if (!existsSync(skillPath)) {
        throw new Error(`技能 "${skillName}" 不存在`);
    }

    // 删除目录
    rmSync(skillPath, { recursive: true, force: true });

    return {
        name: skillName,
        path: skillPath,
    };
}
