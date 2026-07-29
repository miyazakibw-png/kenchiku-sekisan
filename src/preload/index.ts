import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AssemblyMasterOptions,
  Detail,
  FinishAssembly,
  MasterOptions,
  SaveAssemblyRequest,
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
  saveAssembly: (request: SaveAssemblyRequest): Promise<FinishAssembly> =>
    ipcRenderer.invoke(IPC.assemblySave, request),
  deleteAssembly: (id: number): Promise<void> => ipcRenderer.invoke(IPC.assemblyDelete, id),
  promoteAssembly: (id: number): Promise<FinishAssembly> =>
    ipcRenderer.invoke(IPC.assemblyPromote, id)
}

export type SekisanApi = typeof api

contextBridge.exposeInMainWorld('sekisan', api)
