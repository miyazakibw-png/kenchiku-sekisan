import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc";
import type { FittingPartValue } from "../core/fittings/partValue";
import type { CalcWindowInput, CalcWindowState } from "../shared/calcWindow";
import type {
  AggregateRun,
  EstimateRowCheck,
  AggregateView,
  AssemblyItem,
  AssemblyMasterOptions,
  BackupInfo,
  BackupResult,
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
  DetailChangeLog,
  EstimateRow,
  FinishAssembly,
  Fitting,
  FormworkTransferView,
  FrameRoomOption,
  FrameSheet,
  GeneralSheet,
  MasterOptions,
  ProjectField,
  PrintResult,
  ProjectLedger,
  ProjectSummary,
  ScreenExcelRequest,
  SaveAssemblyRequest,
  SaveAssemblyResult,
  SaveDetailsRequest,
  SaveEstimateRowsRequest,
  SaveFittingsRequest,
  SaveAggregateEditsRequest,
  SaveFormworkRulesRequest,
  SaveFrameSheetRequest,
  SaveGeneralSheetRequest,
  RoomSheet,
  SaveProjectRequest,
  SaveRoomSheetRequest,
  SaveSubjectsResult,
  SaveTransferRowsRequest,
  Subject,
  SubjectDraft,
  SyncDetailsResult,
  TransferRow,
} from "../shared/types";

const api = {
  /** projectId を渡すと、その工事のマスター（無い種類は基本マスター）を返す */
  getMasterOptions: (projectId: number | null = null): Promise<MasterOptions> =>
    ipcRenderer.invoke(IPC.masterOptions, projectId),
  listBasicMasters: (projectId: number | null = null): Promise<BasicMasters> =>
    ipcRenderer.invoke(IPC.basicMastersList, projectId),
  saveBasicMaster: (
    request: SaveBasicMasterRequest,
  ): Promise<SaveBasicMasterResult> =>
    ipcRenderer.invoke(IPC.basicMasterSave, request),
  listSubjects: (projectId: number | null = null): Promise<Subject[]> =>
    ipcRenderer.invoke(IPC.subjectsList, projectId),
  saveSubjects: (
    rows: SubjectDraft[],
    projectId: number | null = null,
  ): Promise<SaveSubjectsResult> =>
    ipcRenderer.invoke(IPC.subjectsSave, rows, projectId),
  /** 基準マスターを工事へ複製する。複製できた種類を返す */
  copyProjectMasters: (
    projectId: number,
    overwrite = false,
  ): Promise<string[]> =>
    ipcRenderer.invoke(IPC.projectMastersCopy, projectId, overwrite),
  /** その工事が自前で持っているマスターの種類 */
  listProjectMasterKinds: (projectId: number): Promise<string[]> =>
    ipcRenderer.invoke(IPC.projectMastersKinds, projectId),
  /** projectId を渡すと物件専用マスター（工事マスター）の明細を返す */
  listDetails: (
    subjectId: number,
    projectId: number | null = null,
  ): Promise<Detail[]> =>
    ipcRenderer.invoke(IPC.detailsList, subjectId, projectId),
  /** 工事専用としてできた明細だけ（集計書に出ている・工事で直した／足した明細） */
  listProjectDetailsInUse: (
    subjectId: number,
    projectId: number,
  ): Promise<Detail[]> =>
    ipcRenderer.invoke(IPC.detailsListInUse, subjectId, projectId),
  saveDetails: (request: SaveDetailsRequest): Promise<Detail[]> =>
    ipcRenderer.invoke(IPC.detailsSave, request),
  /** 明細マスターの修正履歴（新しい修正が上） */
  listDetailChangeLogs: (
    projectId: number | null = null,
  ): Promise<DetailChangeLog[]> =>
    ipcRenderer.invoke(IPC.detailChangeLogsList, projectId),
  /** 既存工事で物件専用明細が足りないときに基本マスターから複製する（二重複製は取り除く） */
  copyBasicDetailsToProject: (
    projectId: number,
  ): Promise<{ copied: number; removed: number }> =>
    ipcRenderer.invoke(IPC.detailsCopyFromBasic, projectId),
  syncProjectDetailsToBasic: (
    projectId: number,
    subjectId: number,
  ): Promise<SyncDetailsResult> =>
    ipcRenderer.invoke(IPC.detailsSyncToBasic, projectId, subjectId),
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
  /** 行ごとに、中身の入っている計算書の種類（種類を変える前の確認に使う） */
  listFilledCalcSheets: (
    projectId: number,
  ): Promise<Record<number, string[]>> =>
    ipcRenderer.invoke(IPC.estimateRowsFilledSheets, projectId),
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
    /** 計算書で直接入れた寸法を建具表へ反映させるとき */
    overwrite?: boolean,
  ): Promise<Fitting[]> =>
    ipcRenderer.invoke(IPC.roomFittingRegister, projectId, fitting, overwrite),
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
  /** 部位別入力表のチェック列（部位ごとの名称と数量） */
  getEstimateRowChecks: (
    projectId: number,
    materialCategory: string,
  ): Promise<EstimateRowCheck[]> =>
    ipcRenderer.invoke(IPC.estimateRowChecks, projectId, materialCategory),
  /** 集計書兼工事マスターで直した内容を計算書・明細マスターへ書き戻して集計し直す */
  saveAggregateEdits: (
    request: SaveAggregateEditsRequest,
  ): Promise<AggregateView> =>
    ipcRenderer.invoke(IPC.aggregateSaveEdits, request),
  /** 型枠転記（型枠分類別に集計して転記入力表の最終行へ追記） */
  getFormworkTransfer: (projectId: number): Promise<FormworkTransferView> =>
    ipcRenderer.invoke(IPC.formworkTransferGet, projectId),
  saveFormworkRules: (
    request: SaveFormworkRulesRequest,
  ): Promise<FormworkTransferView> =>
    ipcRenderer.invoke(IPC.formworkTransferSaveRules, request),
  runFormworkTransfer: (projectId: number): Promise<FormworkTransferView> =>
    ipcRenderer.invoke(IPC.formworkTransferRun, projectId),
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
  /** 建具記号を計算式へ入れるときに、部位ごとにどの数値を採るか */
  getFittingPartValues: (): Promise<FittingPartValue[]> =>
    ipcRenderer.invoke(IPC.fittingPartValuesGet),
  saveFittingPartValues: (
    values: FittingPartValue[],
  ): Promise<FittingPartValue[]> =>
    ipcRenderer.invoke(IPC.fittingPartValuesSave, values),
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
  /** 積算データの保存場所と件数 */
  getBackupInfo: (): Promise<BackupInfo> => ipcRenderer.invoke(IPC.backupInfo),
  /** 積算データを1ファイルに保存（バックアップ） */
  createBackup: (): Promise<BackupResult> =>
    ipcRenderer.invoke(IPC.backupCreate),
  /** 保存した積算データから復元 */
  restoreBackup: (): Promise<BackupResult> =>
    ipcRenderer.invoke(IPC.backupRestore),
  /** 今の画面をA3横でプリンターへ */
  printPaper: (): Promise<PrintResult> => ipcRenderer.invoke(IPC.printPaper),
  /** 今の画面をA3横のPDFで保存 */
  printPdf: (defaultName: string): Promise<PrintResult> =>
    ipcRenderer.invoke(IPC.printPdf, defaultName),
  /** 今の画面の表を入力表ごとのシートでエクセル保存（式なし・数字のみ） */
  exportScreenExcel: (request: ScreenExcelRequest): Promise<PrintResult> =>
    ipcRenderer.invoke(IPC.screenExcel, request),
  closeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.windowClose),

  /** 明細入力を独立したウィンドウで開く */
  openCalcWindow: (title: string): Promise<void> =>
    ipcRenderer.invoke(IPC.calcWindowOpen, title),
  /** 元の画面 → 明細入力ウィンドウへ内容を渡す */
  pushCalcWindow: (state: CalcWindowState): Promise<void> =>
    ipcRenderer.invoke(IPC.calcWindowPush, state),
  /** 明細入力ウィンドウ → 元の画面へ入力を返す */
  applyCalcWindow: (parentId: number, input: CalcWindowInput): Promise<void> =>
    ipcRenderer.invoke(IPC.calcWindowApply, parentId, input),
  /** 明細入力ウィンドウの読み込み完了を元の画面へ伝える */
  readyCalcWindow: (parentId: number): Promise<void> =>
    ipcRenderer.invoke(IPC.calcWindowReady, parentId),
  /** 明細入力ウィンドウ側で内容を受け取る */
  onCalcWindowState: (
    handler: (state: CalcWindowState) => void,
  ): (() => void) => {
    const listener = (_event: unknown, state: CalcWindowState): void =>
      handler(state);
    ipcRenderer.on(IPC.calcWindowState, listener);
    return () => ipcRenderer.removeListener(IPC.calcWindowState, listener);
  },
  /** 元の画面側で入力・読み込み完了・ウィンドウの終了を受け取る */
  onCalcWindowInput: (
    handler: (input: CalcWindowInput) => void,
  ): (() => void) => {
    const listener = (_event: unknown, input: CalcWindowInput): void =>
      handler(input);
    ipcRenderer.on(IPC.calcWindowInput, listener);
    return () => ipcRenderer.removeListener(IPC.calcWindowInput, listener);
  },
  onCalcWindowReady: (handler: () => void): (() => void) => {
    const listener = (): void => handler();
    ipcRenderer.on(IPC.calcWindowReady, listener);
    return () => ipcRenderer.removeListener(IPC.calcWindowReady, listener);
  },
  onCalcWindowClosed: (handler: () => void): (() => void) => {
    const listener = (): void => handler();
    ipcRenderer.on(IPC.calcWindowClosed, listener);
    return () => ipcRenderer.removeListener(IPC.calcWindowClosed, listener);
  },
};

export type SekisanApi = typeof api;

contextBridge.exposeInMainWorld("sekisan", api);
