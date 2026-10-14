import { readdir, readFile } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import logger from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** skills 目录绝对路径 */
const SKILLS_DIR = resolve(__dirname, "..", "skills");

export let skills = await loadSkills();

/**
 * 从 SKILL.md中提取元数据
 * @param {string} content SKILL.md 文件内容
 * @returns {{name: string, description: string}}
 */
function parseSkillMeta(content) {
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) {
        return { name: "unknown", description: "无 frontmatter" };
    }

    const frontmatter = fmMatch[1];
    const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() || "unknown";
    const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim() || "无描述";

    return { name, description };
}

/**
 * 扫描 core/skills 目录，加载所有 Skill 的元数据
 */
async function loadSkills() {
    const result = [];
    try {
        const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
        const skillDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

        for (const dir of skillDirs) {
            const mdPath = resolve(SKILLS_DIR, dir, "SKILL.md");
            try {
                const content = await readFile(mdPath, "utf-8");
                const meta = parseSkillMeta(content);
                const skillMdPath = `skills${sep}${dir}${sep}SKILL.md`;
                result.push({
                    name: meta.name,
                    description: meta.description,
                    skillMdPath,
                });
                logger.debug(`加载了Skill: ${meta.name}`);
            }
            catch (err) {
                logger.warn(`跳过 Skill 目录 "${dir}"：找不到 SKILL.md`);
            }
        }
    }
    catch (err) {
        if (err.code === "ENOENT") {
            logger.warn("skills 目录不存在");
        }
        logger.error("加载 Skill 失败:", err);
    }
    return result;
}

export async function reloadSkills(){
    skills = await loadSkills();
}