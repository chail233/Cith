import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { defaultSettings, mergeSettings, type UiSettings } from '../shared/settings.ts'

/** 单例缓存：文件只在首次访问时读一次，之后全走内存 */
let cache: UiSettings | null = null

function file(): string {
    return join(app.getPath('userData'), 'settings.json')
}

/** 懒加载：首次读取才碰盘；文件缺失或损坏回落默认值，且不创建文件 */
export function loadSettings(): UiSettings {
    if (cache) return cache
    try {
        cache = mergeSettings(JSON.parse(readFileSync(file(), 'utf8')))
    }
    catch {
        cache = { ...defaultSettings }
    }
    return cache
}

/** 懒创建：首次保存才落盘，返回合并默认值后的生效状态 */
export function saveSettings(raw: unknown): UiSettings {
    cache = mergeSettings(raw)
    writeFileSync(file(), JSON.stringify(cache, null, 2))
    return cache
}
