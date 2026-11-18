// @ts-check

/**
 * 桌面端内置 core 的打包物料装配：dist/ → packages/desktop/core-bundle/
 *
 * 排除开发机密钥与运行数据（config.json / data / .wechatbot / dev 表情清单），
 * 并按 @cith/core 的生产依赖闭包从根 node_modules 复制依赖包——
 * 内置 core 以 ELECTRON_RUN_AS_NODE 独立进程运行，asar 里的依赖它读不到，
 * 技能脚本的运行时依赖这份 node_modules。
 *
 * 由根命令 `npm run bundle:desktop` 在 npm run build 之后调用。
 */

import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");
const bundle = resolve(root, "packages", "desktop", "core-bundle");

/** 不进安装包的路径（相对 dist/，正斜杠）：开发机密钥与运行数据一律排除 */
const EXCLUDED = new Set([
    "config.json",
    "config.json.tmp",
    "data",
    ".wechatbot",
    "stickers/manifest.dev.json",
]);

if (!existsSync(dist)) {
    console.error("[stage-core] dist/ 不存在——先在仓库根执行 npm run build 再装配");
    process.exit(1);
}

// ===== 1. 复制 dist/（带排除） =====
rmSync(bundle, { recursive: true, force: true });
cpSync(dist, bundle, {
    recursive: true,
    filter: (/** @type {string} */ src) => {
        const rel = relative(dist, src).split("\\").join("/");
        return rel === "" || !EXCLUDED.has(rel);
    },
});

// ===== 2. 生产依赖闭包（从 @cith/core 的 package.json 递归遍历，不依赖 npm CLI） =====
let depCount = 0;
const { names, hardDeps } = collectProdClosure();
for (const name of names) {
    const from = join(root, "node_modules", name);
    if (!existsSync(from)) {
        // 未安装的多数是可选 peer（ws 的 bufferutil、jsdom 的 canvas 等），只有硬依赖缺失才值得报警
        if (hardDeps.has(name)) console.warn(`[stage-core] 硬依赖缺失: ${name}`);
        continue;
    }
    // 整目录递归复制：包内嵌套的 node_modules 也一并带上，非提升布局不破
    cpSync(from, join(bundle, "node_modules", name), { recursive: true });
    depCount++;
}
console.log(`[stage-core] 完成: ${bundle}（${Math.round(dirSize(bundle) / 1024 / 1024)} MB，依赖包 ${depCount} 个）`);

/**
 * 递归收集 @cith/core 的生产依赖闭包。
 * 返回 names（全部可达包，含 peer/optional）与 hardDeps（仅经 dependencies 边可达的包）。
 */
function collectProdClosure() {
    const corePkg = JSON.parse(readFileSync(resolve(root, "packages", "core", "package.json"), "utf8"));
    const visited = new Set();
    const hardDeps = new Set();
    const walk = (/** @type {string} */ name, /** @type {boolean} */ hard) => {
        if (visited.has(name)) {
            if (hard) hardDeps.add(name);
            return;
        }
        visited.add(name);
        if (hard) hardDeps.add(name);
        const pkgPath = join(root, "node_modules", name, "package.json");
        if (!existsSync(pkgPath)) return;
        let pkg;
        try {
            pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        }
        catch {
            return;
        }
        for (const dep of Object.keys(pkg.dependencies ?? {})) walk(dep, true);
        for (const field of ["peerDependencies", "optionalDependencies"]) {
            for (const dep of Object.keys(pkg[field] ?? {})) walk(dep, false);
        }
    };
    for (const dep of Object.keys(corePkg.dependencies ?? {})) walk(dep, true);
    for (const dep of Object.keys(corePkg.optionalDependencies ?? {})) walk(dep, false);
    return { names: [...visited], hardDeps };
}

/** 目录体积（字节），仅统计能 stat 的条目 */
function dirSize(/** @type {string} */ dir) {
    let total = 0;
    try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const stat = statSync(join(dir, entry.name));
            total += stat.isDirectory() ? dirSize(join(dir, entry.name)) : stat.size;
        }
    }
    catch { /* 权限不足的条目不计入 */ }
    return total;
}
