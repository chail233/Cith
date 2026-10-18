import { readdir, readFile } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import logger from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** skills 目录绝对路径 */
const SKILLS_DIR = resolve(__dirname, "..", "skills");

/** 技能元数据列表（不含正文） */
export let skills = [];
/** 强加载技能列表（force: true），含 SKILL.md 正文内容 */
export let forceSkills = [];

const initial = await loadSkills();
skills = initial.skills;
forceSkills = initial.force;

/**
 * 从 SKILL.md中提取元数据
 * @param {string} content SKILL.md 文件内容
 * @returns {{name: string, description: string, force: boolean}}
 */
function parseSkillMeta(content) {
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) {
        return { name: "unknown", description: "无 frontmatter", force: false };
    }

    const frontmatter = fmMatch[1];
    const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() || "unknown";
    const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim() || "无描述";
    const force = frontmatter.match(/^force:\s*(.+)$/m)?.[1]?.trim().toLowerCase() === "true";

    return { name, description, force };
}

/**
 * 去除 SKILL.md 的 frontmatter，返回正文内容
 * @param {string} content SKILL.md 文件内容
 * @returns {string}
 */
function stripFrontmatter(content) {
    return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
}

/**
 * 扫描 core/skills 目录，加载所有 Skill 的元数据，并筛选出强加载技能
 * @returns {Promise<{skills: Array, force: Array, ok: boolean}>} ok 为 false 表示目录扫描失败（不应据此覆写快照）
 */
async function loadSkills() {
    const result = [];
    const forced = [];
    let ok = false;
    try {
        const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
        const skillDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

        for (const dir of skillDirs) {
            const mdPath = resolve(SKILLS_DIR, dir, "SKILL.md");
            try {
                const content = await readFile(mdPath, "utf-8");
                const meta = parseSkillMeta(content);
                const skillMdPath = `skills${sep}${dir}${sep}SKILL.md`;
                const item = {
                    name: meta.name,
                    description: meta.description,
                    force: meta.force,
                    skillMdPath,
                };
                result.push(item);

                // 强加载技能额外保存正文内容，供固定注入上下文
                if (meta.force) {
                    forced.push({ ...item, content: stripFrontmatter(content) });
                    logger.debug(`强加载Skill: ${meta.name}`);
                }

                logger.debug(`加载了Skill: ${meta.name}`);
            }
            catch (err) {
                logger.warn(`跳过 Skill 目录 "${dir}"：找不到 SKILL.md`);
            }
        }
        ok = true;
    }
    catch (err) {
        if (err.code === "ENOENT") {
            logger.warn("skills 目录不存在");
        }
        logger.error("加载 Skill 失败:", err);
    }
    return { skills: result, force: forced, ok };
}

/**
 * 重新从磁盘加载技能并刷新全局快照
 * 仅在扫描成功时覆写，避免瞬时 IO 错误清空已有快照
 */
export async function reloadSkills(){
    const loaded = await loadSkills();
    if (loaded.ok) {
        skills = loaded.skills;
        forceSkills = loaded.force;
    }
    return loaded;
}