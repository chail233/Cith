import { ipcRenderer } from 'electron'

/** 渲染层可用的主进程桥接 API，类型经 index.d.ts 暴露给 renderer */
export const desktopApi = {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version')
}

export type DesktopApi = typeof desktopApi
