import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, cpSync } from 'fs'
import { join, resolve } from 'path'
import { randomBytes } from 'crypto'
import type { CoreConfig } from '../shared/core-types.ts'

/**
 * 本地核心的配置与数据目录管理（不 import electron，便于单元测试）
 * 目录布局（coreDataDir 下）：
 *   config.json      —— core 用户配置层（经 CITH_CONFIG 指向这里）
 *   prompts/         —— 系统提示词（core 经 resolveSrcPath 从 CITH_DATA 读取）
 *   skills/          —— 技能目录
 *   stickers/        —— 表情包清单与图片
 *   wechatbot/       —— 微信登录凭证（config.wechatStorageDir 指向这里）
 *   data/            —— core 自建的运行数据（记忆、笔记、落地媒体等）
 */

/** 首次播种的配置模板：只写 GUI 必须管的键，其余全走 core 默认值层 */
function seedConfig(coreDataDir: string): CoreConfig {
    return {
        token: generateToken(),
        web: { token: generateToken() },
        desktopPort: 2147,
        enableOnebot: true,
        enableWechat: true,
        wechatStorageDir: join(coreDataDir, 'wechatbot'),
    }
}

export function generateToken(): string {
    return randomBytes(12).toString('hex')
}

/** config.json 路径 */
function configPath(coreDataDir: string): string {
    return join(coreDataDir, 'config.json')
}


export function ensureCoreData(bundleDir: string, coreDataDir: string): boolean {
    mkdirSync(coreDataDir, { recursive: true })
    let created = false
    if (!existsSync(configPath(coreDataDir))) {
        writeCoreConfigFile(coreDataDir, seedConfig(coreDataDir))
        created = true
    }
    seedDir(bundleDir, coreDataDir, 'prompts')
    seedDir(bundleDir, coreDataDir, 'skills')
    seedDir(bundleDir, coreDataDir, 'stickers')
    return created
}

/** 从安装包整目录播种；目标已存在时跳过（不覆盖用户的本地修改） */
function seedDir(bundleDir: string, coreDataDir: string, name: string): void {
    const from = join(bundleDir, name)
    const to = join(coreDataDir, name)
    if (!existsSync(from) || existsSync(to)) return
    cpSync(from, to, { recursive: true })
}

export function readCoreConfig(coreDataDir: string): CoreConfig {
    try {
        const parsed: unknown = JSON.parse(readFileSync(configPath(coreDataDir), 'utf8'))
        return typeof parsed === 'object' && parsed !== null ? (parsed as CoreConfig) : {}
    }
    catch {
        return {}
    }
}


export function saveCoreConfig(coreDataDir: string, patch: CoreConfig): CoreConfig {
    const merged = deepMerge(readCoreConfig(coreDataDir), patch)
    writeCoreConfigFile(coreDataDir, merged)
    return merged
}


function writeCoreConfigFile(coreDataDir: string, data: CoreConfig): void {
    const target = configPath(coreDataDir)
    const tmp = `${target}.tmp`
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    renameSync(tmp, target)
}

/** 深合并：普通对象递归合并，数组与标量整体覆盖 */
export function deepMerge(target: CoreConfig, patch: CoreConfig): CoreConfig {
    const merged: CoreConfig = { ...target }
    for (const [key, value] of Object.entries(patch)) {
        const current = merged[key]
        merged[key] = isPlainObject(current) && isPlainObject(value)
            ? deepMerge(current, value)
            : value
    }
    return merged
}

function isPlainObject(value: unknown): value is CoreConfig {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}


export function resolveCorePaths(isPackaged: boolean, resourcesPath: string, distPath: string): { entry: string; cwd: string } {
    const entry = isPackaged
        ? join(resourcesPath, 'core', 'index.js')
        : resolve(distPath, 'index.js')
    return { entry, cwd: isPackaged ? join(resourcesPath, 'core') : resolve(distPath, '..') }
}
