/**
 * 删除笔记
 * 参数: { id: number }
 */

import { deleteNote } from "./notes-api.js";

try {
    const args = JSON.parse(process.argv[2] || "{}");
    const result = deleteNote(args);

    console.log("笔记已删除!");
    console.log(JSON.stringify(result, null, 2));
}
catch (err) {
    console.error("删除笔记失败:", err.message);
    process.exit(1);
}
