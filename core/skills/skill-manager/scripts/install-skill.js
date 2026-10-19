/**
 * 安装 Skill
 *
 * 从 GitHub 仓库下载 Skill 到本地 skills 目录
 * 参数: { repo: string } — 仓库地址（如 "owner/repo" 或 "https://github.com/owner/repo"）
 */

import { installSkill } from "./github-api.js";

try {
    const args = JSON.parse(process.argv[2] || "{}");
    const { repo } = args;

    if (!repo) {
        console.error("缺少参数: repo（仓库地址，如 owner/repo 或 https://github.com/owner/repo）");
        process.exit(1);
    }

    console.log("正在安装技能...");
    const result = await installSkill(repo);

    console.log("安装成功!");
    console.log(JSON.stringify(result, null, 2));
}
catch (err) {
    console.error("安装技能失败:", err.message);
    process.exit(1);
}
