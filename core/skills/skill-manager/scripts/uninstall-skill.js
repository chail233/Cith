/**
 * 卸载 Skill
 *
 * 删除本地 skills 目录中的技能
 * 参数: { name: string } — 技能名称（目录名）
 */

import { uninstallSkill } from "./github-api.js";

try {
    const args = JSON.parse(process.argv[2] || "{}");
    const { name } = args;

    if (!name) {
        console.error("缺少参数: name（技能名称，即 skills 目录下的文件夹名）");
        process.exit(1);
    }

    const result = uninstallSkill(name);

    console.log("卸载成功!");
    console.log(JSON.stringify(result, null, 2));
}
catch (err) {
    console.error("卸载技能失败:", err.message);
    process.exit(1);
}
