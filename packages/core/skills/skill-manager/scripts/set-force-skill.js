/**
 * 设置强加载 Skill（force: true）
 *
 * 将指定技能 SKILL.md 的 frontmatter force 字段设为 true，使其正文固定注入对话上下文
 * 参数: { name: string } — 技能名称（skills 目录下的文件夹名）
 */

import { setSkillForce } from "./force-api.js";

try {
    const args = JSON.parse(process.argv[2] || "{}");
    const { name } = args;

    if (!name) {
        console.error("缺少参数: name（技能名称，即 skills 目录下的文件夹名）");
        process.exit(1);
    }

    const result = setSkillForce(name, true);

    console.log("已设置为强加载技能!");
    console.log(JSON.stringify(result, null, 2));
}
catch (err) {
    console.error("设置强加载技能失败:", err.message);
    process.exit(1);
}
