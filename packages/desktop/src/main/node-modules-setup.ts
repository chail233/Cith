import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { extract } from 'tar'

/**
 * 内置核心 node_modules 的首启解压（不 import electron，便于单元测试）
 * 安装包只带单 tar（stage 装配产出），拉起 core 前解压回 resources/core/node_modules
 */

export const TAR_NAME = 'node_modules.tar'
export const MANIFEST_NAME = 'node_modules.tar.json'
const MARKER_NAME = '.cith-setup.json'
const STAGING_NAME = 'node_modules.extracting'
const TRASH_PREFIX = 'node_modules.replacing-'
const PROGRESS_STEP = 400

export interface SetupOptions {
    coreDir: string
    appVersion: string
    onProgress?: (filesDone: number, filesTotal: number) => void
}

export type SetupOutcome = { ok: true; skipped: boolean } | { ok: false; message: string }

interface BundleManifest {
    files?: unknown
    bytes?: unknown
}

export async function ensureNodeModules(options: SetupOptions): Promise<SetupOutcome> {
    const { coreDir, appVersion, onProgress } = options
    const finalDir = join(coreDir, 'node_modules')
    const tarFile = join(coreDir, TAR_NAME)

    if (markerValid(finalDir, appVersion)) return { ok: true, skipped: true }
    if (!existsSync(tarFile)) {
        if (existsSync(finalDir)) return { ok: true, skipped: true }
        return { ok: false, message: `安装包缺少 ${TAR_NAME}（打包产物不完整），请重新安装客户端` }
    }
    const manifest = readManifest(coreDir)
    const filesTotal = typeof manifest.files === 'number' && Number.isFinite(manifest.files) ? manifest.files : 0

    cleanupStale(coreDir)
    const staging = join(coreDir, STAGING_NAME)
    mkdirSync(staging, { recursive: true })

    try {
        let filesDone = 0
        let lastEmit = 0
        const emit = (force = false) => {
            if (!onProgress) return
            if (!force && filesDone - lastEmit < PROGRESS_STEP) return
            lastEmit = filesDone
            onProgress(filesDone, filesTotal)
        }
        await extract({
            file: tarFile,
            cwd: staging,
            // stage 打包顶层带 node_modules/，剥掉这层让内容直接落 staging
            stripComponents: 1,
            onentry: (entry) => {
                if (entry.type !== 'File') return
                filesDone++
                emit()
            },
        })
        emit(true)

        const extracted = countFiles(staging)
        if (filesTotal > 0 && extracted !== filesTotal) {
            throw new Error(`解压结果校验不符：提取 ${extracted} 个文件，manifest 记载 ${filesTotal} 个`)
        }

        writeMarker(staging, appVersion, extracted)
        swapIntoPlace(staging, finalDir, coreDir)
        return { ok: true, skipped: false }
    }
    catch (err) {
        cleanupStale(coreDir)
        const detail = err instanceof Error ? err.message : String(err)
        return { ok: false, message: `解压核心依赖失败: ${detail}（点重试可再次尝试）` }
    }
}

function markerValid(finalDir: string, appVersion: string): boolean {
    try {
        const parsed: unknown = JSON.parse(readFileSync(join(finalDir, MARKER_NAME), 'utf8'))
        return typeof parsed === 'object' && parsed !== null
            && (parsed as { version?: unknown }).version === appVersion
    }
    catch {
        return false
    }
}

function writeMarker(dir: string, appVersion: string, files: number): void {
    writeFileSync(join(dir, MARKER_NAME), `${JSON.stringify({ version: appVersion, files, extractedAt: Date.now() })}\n`, 'utf8')
}

function readManifest(coreDir: string): BundleManifest {
    try {
        const parsed: unknown = JSON.parse(readFileSync(join(coreDir, MANIFEST_NAME), 'utf8'))
        return typeof parsed === 'object' && parsed !== null ? (parsed as BundleManifest) : {}
    }
    catch {
        return {}
    }
}

function swapIntoPlace(staging: string, finalDir: string, coreDir: string): void {
    let trash: string | null = null
    if (existsSync(finalDir)) {
        trash = join(coreDir, `${TRASH_PREFIX}${Date.now()}`)
        renameSync(finalDir, trash)
    }
    try {
        renameSync(staging, finalDir)
    }
    catch (err) {
        if (trash) renameSync(trash, finalDir)
        throw err
    }
    if (trash) rmSync(trash, { recursive: true, force: true })
}

function cleanupStale(coreDir: string): void {
    rmSync(join(coreDir, STAGING_NAME), { recursive: true, force: true })
    try {
        for (const name of readdirSync(coreDir)) {
            if (name.startsWith(TRASH_PREFIX)) rmSync(join(coreDir, name), { recursive: true, force: true })
        }
    }
    catch { /* coreDir 不存在时无需清理 */ }
}

function countFiles(dir: string): number {
    let total = 0
    try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) total += countFiles(join(dir, entry.name))
            else if (entry.isFile()) total++
        }
    }
    catch { /* 权限不足的条目不计入 */ }
    return total
}
