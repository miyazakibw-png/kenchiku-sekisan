import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AssemblyItem,
  AssemblyMasterOptions,
  Detail,
  FinishAssembly,
  MasterOptions,
  SaveAssemblyRequest,
  SaveAssemblyResult,
  SaveDetailsRequest
} from '../shared/types'

const api = {
  getMasterOptions: (): Promise<MasterOptions> => ipcRenderer.invoke(IPC.masterOptions),
  listDetails: (subjectId: number): Promise<Detail[]> =>
    ipcRenderer.invoke(IPC.detailsList, subjectId),
  saveDetails: (request: SaveDetailsRequest): Promise<Detail[]> =>
    ipcRenderer.invoke(IPC.detailsSave, request),
  getAssemblyOptions: (): Promise<AssemblyMasterOptions> =>
    ipcRenderer.invoke(IPC.assemblyOptions),
  listAssemblies: (projectId: number | null): Promise<FinishAssembly[]> =>
    ipcRenderer.invoke(IPC.assemblyList, projectId),
  saveAssembly: (request: SaveAssemblyRequest): Promise<SaveAssemblyResult> =>
    ipcRenderer.invoke(IPC.assemblySave, request),
  buildAssemblyItem: (detailId: number): Promise<AssemblyItem> =>
    ipcRenderer.invoke(IPC.assemblyItemFromDetail, detailId),
  mergeAssemblies: (keepId: number, mergedId: number): Promise<FinishAssembly> =>
    ipcRenderer.invoke(IPC.assemblyMerge, keepId, mergedId),
  promoteAssembly: (id: number): Promise<FinishAssembly> =>
    ipcRenderer.invoke(IPC.assemblyPromote, id)
}

export type SekisanApi = typeof api

contextBridge.exposeInMainWorld('sekisan', api)
