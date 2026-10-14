/**
 * 强加载 Skill 配置封装
 * 修改本地 skills 目录中 SKILL.md 的 frontmatter `force` 字段
 *
 * 设计意图：
 * - 作为 skill-manager 的内部模块，仅供本 skill 的脚本使用
 * - 仅操作 frontmatter 的 force 行，保留其余内容与正文不变
 * - 技能名称即 skills 目录下的文件夹名（与 install/uninstall 一致）
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SKILLS_DIR = resolve(__dirname, "..", "..");

/**
 * 定位技能的 SKILL.md 路径
 * @param {string} skillName 技能名称（目录名）
 * @returns {string}
 */
function findSkillMdPath(skillName) {
    const mdPath = join(SKILLS_DIR, skillName, "SKILL.md");
    if (!existsSync(mdPath)) {
        throw new Error(`技能 "${skillName}" 不存在或缺少 SKILL.md`);
    }
    return mdPath;
}

/**
 * 更新 SKILL.md frontmatter 中的 force 字段
 * 存在则替换值，不存在则在 frontmatter 末尾追加
 * @param {string} content SKILL.md 原始内容
 * @param {boolean} enable 是否强加载
 * @returns {string} 更新后的内容
 */
function updateForceField(content, enable) {
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) {
        throw new Error("SKILL.md 缺少 frontmatter，无法设置 force");
    }

    const value = enable ? "true" : "false";
    const body = fmMatch[1];
    const newBody = /^force:\s*.+$/m.test(body)
        ? body.replace(/^force:\s*.+$/m, `force: ${value}`)
        : `${body}\nforce: ${value}`;

    // frontmatter 锚定在文件开头，直接重建，避免 replace 的 $ 转义问题
    const rest = content.slice(fmMatch[0].length);
    return `---\n${newBody}\n---${rest}`;
}

/**
 * 设置或取消技能的强加载标记
 * @param {string} skillName 技能名称（目录名）
 * @param {boolean} enable true=强加载，false=取消强加载
 * @returns {{name: string, force: boolean, path: string}}
 */
export function setSkillForce(skillName, enable) {
    const mdPath = findSkillMdPath(skillName);
    const content = readFileSync(mdPath, "utf-8");
    const updated = updateForceField(content, enable);
    writeFileSync(mdPath, updated, "utf-8");

    return {
        name: skillName,
        force: enable,
        path: mdPath,
    };
}
