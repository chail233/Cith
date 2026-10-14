/**
 * 更新笔记
 * 参数: { id: number, content?: string, tags?: string[] }
 */

import { updateNote } from "./notes-api.js";

try {
    const args = JSON.parse(process.argv[2] || "{}");
    const result = updateNote(args);

    console.log("笔记已更新!");
    console.log(JSON.stringify(result, null, 2));
}
catch (err) {
    console.error("更新笔记失败:", err.message);
    process.exit(1);
}
