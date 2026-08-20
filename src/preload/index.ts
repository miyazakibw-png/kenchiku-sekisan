import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc";
import type {
  AssemblyItem,
  AssemblyMasterOptions,
  Detail,
  EstimateRow,
  FinishAssembly,
  Fitting,
  MasterOptions,
  ProjectField,
  ProjectLedger,
  ProjectSummary,
  SaveAssemblyRequest,
  SaveAssemblyResult,
  SaveDetailsRequest,
  SaveEstimateRowsRequest,
  SaveFittingsRequest,
  RoomSheet,
  SaveProjectRequest,
  SaveRoomSheetRequest,
  SaveSubjectsResult,
  Subject,
  SubjectDraft,
} from "../shared/types";

const api = {
  getMasterOptions: (): Promise<MasterOptions> =>
    ipcRenderer.invoke(IPC.masterOptions),
  listSubjects: (): Promise<Subject[]> => ipcRenderer.invoke(IPC.subjectsList),
  saveSubjects: (rows: SubjectDraft[]): Promise<SaveSubjectsResult> =>
    ipcRenderer.invoke(IPC.subjectsSave, rows),
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
  mergeAssemblies: (
    keepId: number,
    mergedId: number,
  ): Promise<FinishAssembly> =>
    ipcRenderer.invoke(IPC.assemblyMerge, keepId, mergedId),
  promoteAssembly: (id: number): Promise<FinishAssembly> =>
    ipcRenderer.invoke(IPC.assemblyPromote, id),
  listEstimateRows: (projectId: number): Promise<EstimateRow[]> =>
    ipcRenderer.invoke(IPC.estimateRowsList, projectId),
  saveEstimateRows: (
    request: SaveEstimateRowsRequest,
  ): Promise<EstimateRow[]> =>
    ipcRenderer.invoke(IPC.estimateRowsSave, request),
  /** 部屋計算書の上段。まだ無ければ部位別入力表の行から作られる */
  getRoomSheet: (estimateRowId: number): Promise<RoomSheet> =>
    ipcRenderer.invoke(IPC.roomSheetGet, estimateRowId),
  saveRoomSheet: (request: SaveRoomSheetRequest): Promise<RoomSheet> =>
    ipcRenderer.invoke(IPC.roomSheetSave, request),
  /** 計算書で使った記号が建具表に無ければ登録する */
  registerRoomFitting: (
    projectId: number,
    fitting: {
      symbol: string;
      width: number | null;
      height: number | null;
      sillHeight: number | null;
    },
  ): Promise<Fitting[]> =>
    ipcRenderer.invoke(IPC.roomFittingRegister, projectId, fitting),
  /** 取り合いの欠除：この面積以下は差し引かない */
  getDeductionLimit: (): Promise<number> =>
    ipcRenderer.invoke(IPC.deductionLimitGet),
  saveDeductionLimit: (limit: number): Promise<number> =>
    ipcRenderer.invoke(IPC.deductionLimitSave, limit),
  listFittings: (projectId: number): Promise<Fitting[]> =>
    ipcRenderer.invoke(IPC.fittingsList, projectId),
  saveFittings: (request: SaveFittingsRequest): Promise<Fitting[]> =>
    ipcRenderer.invoke(IPC.fittingsSave, request),
  getProjectLedger: (): Promise<ProjectLedger> =>
    ipcRenderer.invoke(IPC.projectLedger),
  createProject: (name: string): Promise<ProjectSummary> =>
    ipcRenderer.invoke(IPC.projectCreate, name),
  copyProject: (sourceId: number, name: string): Promise<ProjectSummary> =>
    ipcRenderer.invoke(IPC.projectCopy, sourceId, name),
  saveProject: (request: SaveProjectRequest): Promise<ProjectSummary> =>
    ipcRenderer.invoke(IPC.projectSave, request),
  reorderProjects: (orderedIds: number[]): Promise<ProjectSummary[]> =>
    ipcRenderer.invoke(IPC.projectReorder, orderedIds),
  saveProjectFields: (fields: ProjectField[]): Promise<ProjectField[]> =>
    ipcRenderer.invoke(IPC.projectFieldsSave, fields),
  /** 物件を別ウィンドウで開く（複数物件の同時作業） */
  openProjectWindow: (projectId: number): Promise<void> =>
    ipcRenderer.invoke(IPC.projectOpenWindow, projectId),
  closeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.windowClose),
};

export type SekisanApi = typeof api;

contextBridge.exposeInMainWorld("sekisan", api);
