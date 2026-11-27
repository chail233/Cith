import { basename } from 'path'
import { readFile, stat, writeFile } from 'fs/promises'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { PickedFile } from '../preload/api.ts'

/** 单个选取文件的原始字节数上限 */
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
    // 选取文件并读取原始字节；kind 决定图片过滤
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
            const size = (await stat(path)).size
            if (size > MAX_PICK_BYTES) {
                console.warn(`选取的文件过大，已跳过: ${path} (${size} 字节)`)
                continue
            }
            const bytes = await readFile(path)
            if (bytes.byteLength > MAX_PICK_BYTES) continue
            files.push({
                kind: isImage ? 'image' : 'file',
                name: basename(path),
                path,
                mime: mimeFromName(basename(path)),
                size: bytes.byteLength,
                bytes: Uint8Array.from(bytes).buffer,
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
        await writeFile(result.filePath, new Uint8Array(file.bytes))
        return result.filePath
    })

    // 网络链接交给系统浏览器或关联程序
    ipcMain.handle('file:open-external', (_e, uri: unknown): void => {
        if (typeof uri === 'string' && /^https?:\/\//i.test(uri)) void shell.openExternal(uri)
    })
}

function asFilePayload(raw: unknown): { name: string; bytes: ArrayBuffer } | null {
    if (typeof raw !== 'object' || raw === null) return null
    const f = raw as Record<string, unknown>
    if (typeof f.name !== 'string' || f.name === '' || !(f.bytes instanceof ArrayBuffer)) return null
    // 限制保存名只取文件名部分，防止路径穿越
    return { name: basename(f.name), bytes: f.bytes }
}
