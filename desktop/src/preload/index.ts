import { contextBridge } from 'electron'
import { desktopApi } from './api'

contextBridge.exposeInMainWorld('desktop', desktopApi)
