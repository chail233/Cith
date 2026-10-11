// @ts-check

/**
 * 构建辅助脚本：将 tsc 不会输出的非代码资源拷贝到 dist
 *
 * 背景：tsc 只编译 .js/.ts，SKILL.md 等资源文件不会进入 dist，
 * 而运行时 skill 加载器（src/llm/skill.js）按目录扫描 SKILL.md，
 * 且 dist 与 src 目录层级一致（rootDir: src → outDir: dist），
 * 因此只需把这些文件按相同结构拷贝过去。
 *
 * .js 文件跳过：它们已由 tsc 编译输出，避免源码覆盖编译产物。
 */

import { cpSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const srcDir = resolve(root, "src");
const distDir = resolve(root, "dist");

/** 需要从 src 同步到 dist 的目录（相对 src） */
const COPY_DIRS = ["skills", "workspace"];

/** 拷贝时跳过的文件类型（已由 tsc 编译输出） */
const SKIP_EXT = new Set([".js", ".ts"]);

/**
 * fs.cpSync 的 filter：跳过 .js/.ts 文件，目录一律放行（保持结构）
 * @param {string} source
 * @returns {boolean}
 */
function notCompiledFile(source) {
    const ext = source.slice(source.lastIndexOf("."));
    return !SKIP_EXT.has(ext.toLowerCase());
}

let copied = 0;
for (const dir of COPY_DIRS) {
    const from = resolve(srcDir, dir);
    const to = resolve(distDir, dir);
    if (!existsSync(from)) {
        console.log(`[copy-assets] 跳过 "${dir}"（源目录不存在）`);
        continue;
    }
    cpSync(from, to, { recursive: true, filter: notCompiledFile });
    copied++;
    console.log(`[copy-assets] 已拷贝 ${dir} -> dist/${dir}（不含 .js/.ts）`);
}

console.log(`[copy-assets] 完成，共处理 ${copied} 个目录`);
