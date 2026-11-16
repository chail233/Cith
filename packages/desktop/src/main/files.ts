import { basename } from 'path'
import { readFile, statSync, writeFile } from 'fs'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { PickedFile } from '../preload/api.ts'

/** 单个选取文件的体积上限；超出直接不返回（base64 随帧携带，别撑爆 WS） */
const MAX_PICK_BYTES = 25 * 1024 * 1024

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']

const MIME_BY_EXT: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    pdf: 'application/pdf',
    zip: 'application/zip',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    csv: 'text/csv',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

function mimeFromName(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

function currentWindow(): BrowserWindow | null {
    return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}


export function registerFileHandlers(): void {
    // 选取文件并读成 base64；kind 决定图片过滤
    ipcMain.handle('dialog:pick', async (_e, kind: unknown): Promise<PickedFile[]> => {
        const win = currentWindow()
        if (!win) return []
        const isImage = kind === 'image'
        const result = await dialog.showOpenDialog(win, {
            title: isImage ? '选择图片' : '选择文件',
            properties: ['openFile', 'multiSelections'],
            ...(isImage ? { filters: [{ name: '图片', extensions: IMAGE_EXTENSIONS }] } : {}),
        })
        if (result.canceled || result.filePaths.length === 0) return []
        const files: PickedFile[] = []
        for (const path of result.filePaths) {
            const size = statSync(path).size
            if (size > MAX_PICK_BYTES) {
                console.warn(`选取的文件过大，已跳过: ${path} (${size} 字节)`)
                continue
            }
            const base64 = await new Promise<string>((resolve, reject) => {
                readFile(path, (err, buf) => (err ? reject(err) : resolve(buf.toString('base64'))))
            })
            files.push({
                kind: isImage ? 'image' : 'file',
                name: basename(path),
                path,
                mime: mimeFromName(basename(path)),
                size,
                base64,
            })
        }
        return files
    })

    // 收到的文件落盘：弹出保存对话框，返回最终路径；取消为 null
    ipcMain.handle('file:save', async (_e, raw: unknown): Promise<string | null> => {
        const file = asFilePayload(raw)
        if (!file) return null
        const win = currentWindow()
        if (!win) return null
        const result = await dialog.showSaveDialog(win, {
            defaultPath: `${app.getPath('downloads')}/${file.name}`,
        })
        if (result.canceled || !result.filePath) return null
        await new Promise<void>((resolve, reject) => {
            writeFile(result.filePath!, Buffer.from(file.base64, 'base64'), (err) => (err ? reject(err) : resolve()))
        })
        return result.filePath
    })

    // 没有 base64 的文件（http 引用）交给系统浏览器/关联程序
    ipcMain.handle('file:open-external', (_e, uri: unknown): void => {
        if (typeof uri === 'string' && /^https?:\/\//i.test(uri)) void shell.openExternal(uri)
    })
}

function asFilePayload(raw: unknown): { name: string; base64: string } | null {
    if (typeof raw !== 'object' || raw === null) return null
    const f = raw as Record<string, unknown>
    if (typeof f.name !== 'string' || f.name === '' || typeof f.base64 !== 'string' || f.base64 === '') return null
    // 限制保存名只取文件名部分，防止路径穿越
    return { name: basename(f.name), base64: f.base64 }
}
