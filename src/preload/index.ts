import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc";
import type {
  AggregateRun,
  AggregateView,
  AssemblyItem,
  AssemblyMasterOptions,
  BasicMasters,
  SaveBasicMasterRequest,
  SaveBasicMasterResult,
  BreakdownExportRequest,
  BreakdownExportResult,
  BreakdownSettingsRecord,
  BreakdownVersion,
  BreakdownView,
  BreakdownRowRecord,
  SaveBreakdownRowsRequest,
  Detail,
  EstimateRow,
  FinishAssembly,
  Fitting,
  FrameRoomOption,
  FrameSheet,
  GeneralSheet,
  MasterOptions,
  ProjectField,
  ProjectLedger,
  ProjectSummary,
  SaveAssemblyRequest,
  SaveAssemblyResult,
  SaveDetailsRequest,
  SaveEstimateRowsRequest,
  SaveFittingsRequest,
  SaveFrameSheetRequest,
  SaveGeneralSheetRequest,
  RoomSheet,
  SaveProjectRequest,
  SaveRoomSheetRequest,
  SaveSubjectsResult,
  SaveTransferRowsRequest,
  Subject,
  SubjectDraft,
  TransferRow,
} from "../shared/types";

const api = {
  getMasterOptions: (): Promise<MasterOptions> =>
    ipcRenderer.invoke(IPC.masterOptions),
  listBasicMasters: (): Promise<BasicMasters> =>
    ipcRenderer.invoke(IPC.basicMastersList),
  saveBasicMaster: (
    request: SaveBasicMasterRequest,
  ): Promise<SaveBasicMasterResult> =>
    ipcRenderer.invoke(IPC.basicMasterSave, request),
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
  /** 軸組計算書の上段。まだ無ければ部位別入力表の行から作られる */
  getFrameSheet: (estimateRowId: number): Promise<FrameSheet> =>
    ipcRenderer.invoke(IPC.frameSheetGet, estimateRowId),
  saveFrameSheet: (request: SaveFrameSheetRequest): Promise<FrameSheet> =>
    ipcRenderer.invoke(IPC.frameSheetSave, request),
  /** 軸組計算書のレイアウトに置ける部屋（部屋計算書を作った行） */
  listFrameRooms: (projectId: number): Promise<FrameRoomOption[]> =>
    ipcRenderer.invoke(IPC.frameRoomsList, projectId),
  /** 汎用計算書（上段が無く、セット明細計算表だけの計算書） */
  getGeneralSheet: (estimateRowId: number): Promise<GeneralSheet> =>
    ipcRenderer.invoke(IPC.generalSheetGet, estimateRowId),
  saveGeneralSheet: (request: SaveGeneralSheetRequest): Promise<GeneralSheet> =>
    ipcRenderer.invoke(IPC.generalSheetSave, request),
  /** 転記入力表（集計書兼工事マスターへ直接計上する1明細入力） */
  listTransferRows: (projectId: number): Promise<TransferRow[]> =>
    ipcRenderer.invoke(IPC.transferRowsList, projectId),
  saveTransferRows: (
    request: SaveTransferRowsRequest,
  ): Promise<TransferRow[]> =>
    ipcRenderer.invoke(IPC.transferRowsSave, request),
  /** 集計処理（集計書兼工事マスターと集計詳細データを作る） */
  runAggregation: (projectId: number): Promise<AggregateView> =>
    ipcRenderer.invoke(IPC.aggregateRun, projectId),
  getAggregate: (projectId: number, runId?: number): Promise<AggregateView> =>
    ipcRenderer.invoke(IPC.aggregateGet, projectId, runId),
  listAggregateRuns: (projectId: number): Promise<AggregateRun[]> =>
    ipcRenderer.invoke(IPC.aggregateRuns, projectId),
  /** 内訳書（集計書兼工事マスターからの変換転記） */
  getBreakdown: (
    projectId: number,
    versionId?: number,
  ): Promise<BreakdownView> =>
    ipcRenderer.invoke(IPC.breakdownGet, projectId, versionId),
  listBreakdownVersions: (projectId: number): Promise<BreakdownVersion[]> =>
    ipcRenderer.invoke(IPC.breakdownVersions, projectId),
  transferBreakdown: (projectId: number): Promise<BreakdownView> =>
    ipcRenderer.invoke(IPC.breakdownTransfer, projectId),
  saveBreakdownRows: (
    request: SaveBreakdownRowsRequest,
  ): Promise<BreakdownRowRecord[]> =>
    ipcRenderer.invoke(IPC.breakdownSaveRows, request),
  saveBreakdownSettings: (
    settings: BreakdownSettingsRecord,
  ): Promise<BreakdownSettingsRecord> =>
    ipcRenderer.invoke(IPC.breakdownSaveSettings, settings),
  confirmBreakdownVersion: (
    versionId: number,
  ): Promise<BreakdownVersion | null> =>
    ipcRenderer.invoke(IPC.breakdownConfirm, versionId),
  exportBreakdown: (
    request: BreakdownExportRequest,
  ): Promise<BreakdownExportResult> =>
    ipcRenderer.invoke(IPC.breakdownExport, request),
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
