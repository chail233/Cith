/**
 * 添加笔记
 * 参数: { content: string, tags?: string[] }
 */

import { addNote } from "./notes-api.js";

try {
    const args = JSON.parse(process.argv[2] || "{}");
    const result = addNote(args);

    console.log("笔记已添加!");
    console.log(JSON.stringify(result, null, 2));
}
catch (err) {
    console.error("添加笔记失败:", err.message);
    process.exit(1);
}
