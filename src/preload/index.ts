import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { Detail, MasterOptions, SaveDetailsRequest } from '../shared/types'

const api = {
  getMasterOptions: (): Promise<MasterOptions> => ipcRenderer.invoke(IPC.masterOptions),
  listDetails: (subjectId: number): Promise<Detail[]> =>
    ipcRenderer.invoke(IPC.detailsList, subjectId),
  saveDetails: (request: SaveDetailsRequest): Promise<Detail[]> =>
    ipcRenderer.invoke(IPC.detailsSave, request)
}

export type SekisanApi = typeof api

contextBridge.exposeInMainWorld('sekisan', api)
