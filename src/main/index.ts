import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "fs";
import { dirname, join } from "path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  webContents,
  type WebContents,
} from "electron";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import {
  backupDatabaseTo,
  checkBackupFile,
  closeDatabase,
  getDatabase,
  getDatabasePath,
  initDatabase,
  restoreDatabaseFrom,
  schema,
} from "./db";
import {
  autoBackupFileName,
  backupFileName,
  expiredAutoBackups,
  rollbackFileName,
} from "../core/backup/backupName";
import {
  copyBasicDetailsToProject,
  listDetailChangeLogs,
  listDetails,
  listProjectDetailsInUse,
  listMasterOptions,
  saveDetails,
  syncProjectDetailsToBasic,
} from "./services/detailService";
import {
  buildItemFromDetail,
  listAssemblies,
  listAssemblyMasterOptions,
  mergeAssemblies,
  promoteAssemblyToBasic,
  saveAssembly,
} from "./services/assemblyService";
import {
  copyProject,
  createProject,
  getProject,
  listProjectLedger,
  reorderProjects,
  saveProject,
  saveProjectFields,
} from "./services/projectService";
import { listSubjects, saveSubjects } from "./services/subjectService";
import {
  listBasicMasters,
  saveBasicMaster,
} from "./services/basicMasterService";
import {
  copyBasicMastersToProject,
  listProjectBasicMasters,
  listProjectSubjects,
  projectMasterKinds,
  saveProjectBasicMaster,
  saveProjectSubjects,
} from "./services/projectMasterService";
import {
  getFittingPartValues,
  listFittings,
  saveFittingPartValues,
  saveFittings,
} from "./services/fittingService";
import {
  listEstimateRows,
  listFilledCalcSheets,
  saveEstimateRows,
} from "./services/estimateRowService";
import {
  getDeductionLimit,
  getRoomSheet,
  registerRoomFitting,
  saveDeductionLimit,
  saveRoomSheet,
} from "./services/roomSheetService";
import {
  getFrameSheet,
  listFrameRooms,
  saveFrameSheet,
} from "./services/frameSheetService";
import {
  getGeneralSheet,
  saveGeneralSheet,
} from "./services/generalSheetService";
import {
  listTransferRows,
  saveTransferRows,
} from "./services/transferRowService";
import {
  getAggregate,
  collectEstimateRowChecks,
  listAggregateRuns,
  runAggregation,
  saveAggregateEdits,
  setDetailUnused,
} from "./services/aggregationService";
import {
  getFormworkTransfer,
  runFormworkTransfer,
  saveFormworkRules,
} from "./services/formworkTransferService";
import {
  confirmBreakdownVersion,
  deleteBreakdownVersion,
  getBreakdown,
  listBreakdownVersions,
  saveBreakdownRows,
  saveBreakdownSettings,
  transferBreakdown,
} from "./services/breakdownService";
import { buildExport, writeExport } from "./services/breakdownExportService";
import { toScreenWorkbook } from "../core/export/screenSheet";
import type { FittingPartValue } from "../core/fittings/partValue";
import type { CalcWindowInput, CalcWindowState } from "../shared/calcWindow";
import { IPC } from "../shared/ipc";
import type {
  BackupInfo,
  BackupResult,
  PrintResult,
  ScreenExcelRequest,
  SaveBasicMasterRequest,
  BreakdownExportRequest,
  BreakdownExportResult,
  BreakdownSettingsRecord,
  SaveBreakdownRowsRequest,
  ProjectField,
  SaveAssemblyRequest,
  SaveDetailsRequest,
  SaveEstimateRowsRequest,
  SaveFittingsRequest,
  SaveFrameSheetRequest,
  SaveGeneralSheetRequest,
  SaveProjectRequest,
  SaveRoomSheetRequest,
  SaveAggregateEditsRequest,
  SaveFormworkRulesRequest,
  SaveTransferRowsRequest,
  SetDetailUnusedRequest,
  SubjectDraft,
} from "../shared/types";
import { rememberWindowState, savedBounds, wasMaximized } from "./windowState";

/** 物件ごとに独立したウィンドウで開けるようにする（複数物件の同時作業用） */
function createWindow(projectId?: number): void {
  const window = new BrowserWindow({
    ...savedBounds("main", { width: 1440, height: 900 }),
    show: false,
    title: "建築積算システム",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
    },
  });

  // 前回使った大きさ・位置を覚えておき、次に開いたとき同じ大きさで出す
  rememberWindowState(window, "main");
  if (wasMaximized("main")) window.maximize();

  // 出したあと画面（webContents）にも入力先を渡す（Windowsで文字が入らないことへの備え）
  window.on("ready-to-show", () => {
    window.show();
    window.focus();
    window.webContents.focus();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const hash = projectId === undefined ? "" : `project=${projectId}`;

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    window.loadURL(
      hash
        ? `${process.env["ELECTRON_RENDERER_URL"]}#${hash}`
        : process.env["ELECTRON_RENDERER_URL"],
    );
  } else {
    window.loadFile(
      join(__dirname, "../renderer/index.html"),
      hash ? { hash } : undefined,
    );
  }
}

/** 明細入力ウィンドウ（親のwebContents ID → 子ウィンドウ） */
const calcWindows = new Map<number, BrowserWindow>();

/**
 * 明細入力（セット明細計算表）を独立したウィンドウで開く。
 * 入力の中身は元の画面が持ち、ウィンドウとは表示（親→子）と入力（子→親）をやり取りする。
 */
function openCalcWindow(parent: WebContents, title: string): void {
  const opened = calcWindows.get(parent.id);
  if (opened && !opened.isDestroyed()) {
    opened.focus();
    return;
  }

  const window = new BrowserWindow({
    ...savedBounds("calc", { width: 1180, height: 620 }),
    show: false,
    title,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
    },
  });
  calcWindows.set(parent.id, window);
  rememberWindowState(window, "calc");
  if (wasMaximized("calc")) window.maximize();

  window.on("ready-to-show", () => {
    window.show();
    window.focus();
    window.webContents.focus();
  });
  window.on("closed", () => {
    calcWindows.delete(parent.id);
    if (!parent.isDestroyed()) parent.send(IPC.calcWindowClosed);
  });

  const hash = `calc=${parent.id}`;
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    void window.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}#${hash}`);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"), { hash });
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC.masterOptions, (_event, projectId: number | null = null) =>
    listMasterOptions(getDatabase(), projectId),
  );
  ipcMain.handle(
    IPC.basicMastersList,
    (_event, projectId: number | null = null) =>
      projectId === null
        ? listBasicMasters(getDatabase())
        : listProjectBasicMasters(getDatabase(), projectId),
  );
  ipcMain.handle(
    IPC.basicMasterSave,
    (_event, request: SaveBasicMasterRequest) => {
      const projectId = request.projectId ?? null;
      return projectId === null
        ? saveBasicMaster(getDatabase(), request.kind, request.rows)
        : saveProjectBasicMaster(
            getDatabase(),
            projectId,
            request.kind,
            request.rows,
          );
    },
  );
  ipcMain.handle(IPC.subjectsList, (_event, projectId: number | null = null) =>
    projectId === null
      ? listSubjects(getDatabase())
      : listProjectSubjects(getDatabase(), projectId),
  );
  ipcMain.handle(
    IPC.subjectsSave,
    (_event, rows: SubjectDraft[], projectId: number | null = null) =>
      projectId === null
        ? saveSubjects(getDatabase(), rows)
        : saveProjectSubjects(getDatabase(), projectId, rows),
  );
  ipcMain.handle(
    IPC.projectMastersCopy,
    (_event, projectId: number, overwrite = false) =>
      copyBasicMastersToProject(getDatabase(), projectId, overwrite),
  );
  ipcMain.handle(IPC.projectMastersKinds, (_event, projectId: number) =>
    projectMasterKinds(getDatabase(), projectId),
  );
  ipcMain.handle(IPC.estimateRowsList, (_event, projectId: number) =>
    listEstimateRows(getDatabase(), projectId),
  );
  ipcMain.handle(IPC.estimateRowsFilledSheets, (_event, projectId: number) =>
    listFilledCalcSheets(getDatabase(), projectId),
  );
  ipcMain.handle(
    IPC.estimateRowsSave,
    (_event, request: SaveEstimateRowsRequest) =>
      saveEstimateRows(getDatabase(), request),
  );
  ipcMain.handle(IPC.roomSheetGet, (_event, estimateRowId: number) =>
    getRoomSheet(getDatabase(), estimateRowId),
  );
  ipcMain.handle(IPC.roomSheetSave, (_event, request: SaveRoomSheetRequest) =>
    saveRoomSheet(getDatabase(), request),
  );
  ipcMain.handle(
    IPC.roomFittingRegister,
    (
      _event,
      projectId: number,
      fitting: {
        symbol: string;
        width: number | null;
        height: number | null;
        sillHeight: number | null;
      },
      overwrite?: boolean,
    ) =>
      registerRoomFitting(
        getDatabase(),
        projectId,
        fitting,
        overwrite ?? false,
      ),
  );
  ipcMain.handle(IPC.frameSheetGet, (_event, estimateRowId: number) =>
    getFrameSheet(getDatabase(), estimateRowId),
  );
  ipcMain.handle(IPC.frameSheetSave, (_event, request: SaveFrameSheetRequest) =>
    saveFrameSheet(getDatabase(), request),
  );
  ipcMain.handle(IPC.frameRoomsList, (_event, projectId: number) =>
    listFrameRooms(getDatabase(), projectId),
  );
  ipcMain.handle(IPC.generalSheetGet, (_event, estimateRowId: number) =>
    getGeneralSheet(getDatabase(), estimateRowId),
  );
  ipcMain.handle(
    IPC.generalSheetSave,
    (_event, request: SaveGeneralSheetRequest) =>
      saveGeneralSheet(getDatabase(), request),
  );
  ipcMain.handle(IPC.transferRowsList, (_event, projectId: number) =>
    listTransferRows(getDatabase(), projectId),
  );
  ipcMain.handle(
    IPC.transferRowsSave,
    (_event, request: SaveTransferRowsRequest) =>
      saveTransferRows(getDatabase(), request),
  );
  ipcMain.handle(IPC.aggregateRun, (_event, projectId: number) =>
    runAggregation(getDatabase(), projectId),
  );
  ipcMain.handle(
    IPC.aggregateGet,
    (_event, projectId: number, runId?: number) =>
      getAggregate(getDatabase(), projectId, runId),
  );
  ipcMain.handle(
    IPC.estimateRowChecks,
    (_event, projectId: number, materialCategory: string) =>
      collectEstimateRowChecks(getDatabase(), projectId, materialCategory),
  );
  ipcMain.handle(IPC.aggregateRuns, (_event, projectId: number) =>
    listAggregateRuns(getDatabase(), projectId),
  );
  ipcMain.handle(
    IPC.aggregateSaveEdits,
    (_event, request: SaveAggregateEditsRequest) =>
      saveAggregateEdits(getDatabase(), request),
  );
  ipcMain.handle(
    IPC.aggregateSetUnused,
    (_event, request: SetDetailUnusedRequest) =>
      setDetailUnused(getDatabase(), request),
  );
  ipcMain.handle(IPC.formworkTransferGet, (_event, projectId: number) =>
    getFormworkTransfer(getDatabase(), projectId),
  );
  ipcMain.handle(
    IPC.formworkTransferSaveRules,
    (_event, request: SaveFormworkRulesRequest) =>
      saveFormworkRules(getDatabase(), request),
  );
  ipcMain.handle(IPC.formworkTransferRun, (_event, projectId: number) =>
    runFormworkTransfer(getDatabase(), projectId),
  );
  ipcMain.handle(
    IPC.breakdownGet,
    (_event, projectId: number, versionId?: number) =>
      getBreakdown(getDatabase(), projectId, versionId),
  );
  ipcMain.handle(IPC.breakdownVersions, (_event, projectId: number) =>
    listBreakdownVersions(getDatabase(), projectId),
  );
  ipcMain.handle(IPC.breakdownTransfer, (_event, projectId: number) =>
    transferBreakdown(getDatabase(), projectId),
  );
  ipcMain.handle(
    IPC.breakdownSaveRows,
    (_event, request: SaveBreakdownRowsRequest) =>
      saveBreakdownRows(getDatabase(), request.versionId, request.rows),
  );
  ipcMain.handle(
    IPC.breakdownSaveSettings,
    (_event, settings: BreakdownSettingsRecord) =>
      saveBreakdownSettings(getDatabase(), settings),
  );
  ipcMain.handle(IPC.breakdownConfirm, (_event, versionId: number) =>
    confirmBreakdownVersion(getDatabase(), versionId),
  );
  ipcMain.handle(IPC.breakdownDeleteVersion, (_event, versionId: number) =>
    deleteBreakdownVersion(getDatabase(), versionId),
  );
  ipcMain.handle(
    IPC.breakdownExport,
    async (
      event,
      request: BreakdownExportRequest,
    ): Promise<BreakdownExportResult> => {
      const db = getDatabase();
      const view = getBreakdown(db, request.projectId, request.versionId);
      const project = getProject(db, request.projectId);
      const { content, defaultName } = buildExport(
        request.kind,
        view.rows,
        view.settings,
        project.name,
      );
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = window
        ? await dialog.showSaveDialog(window, { defaultPath: defaultName })
        : await dialog.showSaveDialog({ defaultPath: defaultName });
      if (result.canceled || !result.filePath) return { filePath: null };
      writeExport(result.filePath, content);
      return { filePath: result.filePath };
    },
  );
  ipcMain.handle(IPC.deductionLimitGet, () => getDeductionLimit(getDatabase()));
  ipcMain.handle(IPC.deductionLimitSave, (_event, limit: number) =>
    saveDeductionLimit(getDatabase(), limit),
  );
  ipcMain.handle(IPC.fittingsList, (_event, projectId: number) =>
    listFittings(getDatabase(), projectId),
  );
  ipcMain.handle(IPC.fittingsSave, (_event, request: SaveFittingsRequest) =>
    saveFittings(getDatabase(), request),
  );
  ipcMain.handle(IPC.fittingPartValuesGet, () =>
    getFittingPartValues(getDatabase()),
  );
  ipcMain.handle(
    IPC.fittingPartValuesSave,
    (_event, values: FittingPartValue[]) =>
      saveFittingPartValues(getDatabase(), values),
  );
  ipcMain.handle(
    IPC.detailsList,
    (_event, subjectId: number, projectId: number | null = null) =>
      listDetails(getDatabase(), subjectId, projectId),
  );
  ipcMain.handle(
    IPC.detailsListInUse,
    (_event, subjectId: number, projectId: number) =>
      listProjectDetailsInUse(getDatabase(), subjectId, projectId),
  );
  ipcMain.handle(IPC.detailsCopyFromBasic, (_event, projectId: number) =>
    copyBasicDetailsToProject(getDatabase(), projectId),
  );
  ipcMain.handle(
    IPC.detailsSyncToBasic,
    (_event, projectId: number, subjectId: number) =>
      syncProjectDetailsToBasic(getDatabase(), projectId, subjectId),
  );
  ipcMain.handle(
    IPC.detailChangeLogsList,
    (_event, projectId: number | null = null) =>
      listDetailChangeLogs(getDatabase(), projectId),
  );
  ipcMain.handle(IPC.detailsSave, (_event, request: SaveDetailsRequest) =>
    saveDetails(getDatabase(), request),
  );
  ipcMain.handle(IPC.assemblyOptions, () =>
    listAssemblyMasterOptions(getDatabase()),
  );
  ipcMain.handle(IPC.assemblyList, (_event, projectId: number | null) =>
    listAssemblies(getDatabase(), projectId),
  );
  ipcMain.handle(IPC.assemblySave, (_event, request: SaveAssemblyRequest) =>
    saveAssembly(getDatabase(), request),
  );
  ipcMain.handle(IPC.assemblyItemFromDetail, (_event, detailId: number) =>
    buildItemFromDetail(getDatabase(), detailId),
  );
  ipcMain.handle(
    IPC.assemblyMerge,
    (_event, keepId: number, mergedId: number) =>
      mergeAssemblies(getDatabase(), keepId, mergedId),
  );
  ipcMain.handle(IPC.assemblyPromote, (_event, id: number) =>
    promoteAssemblyToBasic(getDatabase(), id),
  );
  ipcMain.handle(IPC.projectLedger, () => listProjectLedger(getDatabase()));
  ipcMain.handle(IPC.projectCreate, (_event, name: string) =>
    createProject(getDatabase(), name),
  );
  ipcMain.handle(IPC.projectCopy, (_event, sourceId: number, name: string) =>
    copyProject(getDatabase(), sourceId, name),
  );
  ipcMain.handle(IPC.projectSave, (_event, request: SaveProjectRequest) =>
    saveProject(getDatabase(), request),
  );
  ipcMain.handle(IPC.projectReorder, (_event, orderedIds: number[]) =>
    reorderProjects(getDatabase(), orderedIds),
  );
  ipcMain.handle(IPC.projectFieldsSave, (_event, fields: ProjectField[]) =>
    saveProjectFields(getDatabase(), fields),
  );
  ipcMain.handle(IPC.projectOpenWindow, (_event, projectId: number) =>
    createWindow(projectId),
  );
  ipcMain.handle(IPC.calcWindowOpen, (event, title: string) =>
    openCalcWindow(event.sender, title),
  );
  ipcMain.handle(IPC.calcWindowPush, (event, state: CalcWindowState) => {
    const window = calcWindows.get(event.sender.id);
    if (window && !window.isDestroyed())
      window.webContents.send(IPC.calcWindowState, state);
  });
  ipcMain.handle(
    IPC.calcWindowApply,
    (_event, parentId: number, input: CalcWindowInput) => {
      const parent = webContents.fromId(parentId);
      if (parent && !parent.isDestroyed())
        parent.send(IPC.calcWindowInput, input);
    },
  );
  ipcMain.handle(IPC.calcWindowReady, (_event, parentId: number) => {
    const parent = webContents.fromId(parentId);
    if (parent && !parent.isDestroyed()) parent.send(IPC.calcWindowReady);
  });
  ipcMain.handle(IPC.backupInfo, (): BackupInfo => {
    const databasePath = getDatabasePath();
    const projectCount = getDatabase()
      .select()
      .from(schema.projects)
      .all().length;
    let size = 0;
    try {
      size = statSync(databasePath).size;
    } catch {
      size = 0;
    }
    return { databasePath, size, projectCount };
  });
  ipcMain.handle(IPC.backupCreate, async (event): Promise<BackupResult> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const defaultPath = join(
      app.getPath("documents"),
      backupFileName(new Date()),
    );
    const options = {
      title: "積算データの保存先を選んでください",
      defaultPath,
      filters: [{ name: "積算データ", extensions: ["db"] }],
    };
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath)
      return { done: false, filePath: null, message: "取り消しました。" };
    await backupDatabaseTo(result.filePath);
    return {
      done: true,
      filePath: result.filePath,
      message: `積算データを保存しました：${result.filePath}`,
    };
  });
  ipcMain.handle(IPC.backupRestore, async (event): Promise<BackupResult> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "復元する積算データを選んでください",
      properties: ["openFile" as const],
      filters: [{ name: "積算データ", extensions: ["db"] }],
    };
    const picked = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0)
      return { done: false, filePath: null, message: "取り消しました。" };
    const sourcePath = picked.filePaths[0];
    const checked = checkBackupFile(sourcePath);
    if (!checked.ok)
      return { done: false, filePath: sourcePath, message: checked.message };
    const confirmOptions = {
      type: "warning" as const,
      buttons: ["復元する", "やめる"],
      defaultId: 1,
      cancelId: 1,
      title: "積算データの復元",
      message: "今の積算データを、選んだファイルの内容に置き換えます。",
      detail: `復元するデータ：${checked.message}\n今のデータは自動で退避してから置き換えます。復元後はソフトを開き直してください。`,
    };
    const answer = window
      ? await dialog.showMessageBox(window, confirmOptions)
      : await dialog.showMessageBox(confirmOptions);
    if (answer.response !== 0)
      return { done: false, filePath: sourcePath, message: "取り消しました。" };
    const rollbackPath = join(
      dirname(getDatabasePath()),
      rollbackFileName(new Date()),
    );
    await restoreDatabaseFrom(sourcePath, rollbackPath);
    const doneOptions = {
      type: "info" as const,
      buttons: ["OK"],
      title: "積算データの復元",
      message: `復元しました（${checked.message}）。`,
      detail: `復元前のデータは次の場所に退避しています。\n${rollbackPath}`,
    };
    if (window) await dialog.showMessageBox(window, doneOptions);
    else await dialog.showMessageBox(doneOptions);
    for (const opened of BrowserWindow.getAllWindows()) {
      opened.webContents.reload();
    }
    return {
      done: true,
      filePath: sourcePath,
      message: `復元しました（${checked.message}）。復元前のデータは ${rollbackPath} に退避しています。`,
    };
  });
  ipcMain.handle(IPC.printPaper, async (event): Promise<PrintResult> => {
    await new Promise<void>((resolve) => {
      event.sender.print(
        { landscape: true, pageSize: "A3", printBackground: true },
        () => resolve(),
      );
    });
    return { filePath: null };
  });
  ipcMain.handle(
    IPC.printPdf,
    async (event, defaultName: string): Promise<PrintResult> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = window
        ? await dialog.showSaveDialog(window, {
            defaultPath: `${defaultName}.pdf`,
          })
        : await dialog.showSaveDialog({ defaultPath: `${defaultName}.pdf` });
      if (result.canceled || !result.filePath) return { filePath: null };
      const pdf = await event.sender.printToPDF({
        landscape: true,
        pageSize: "A3",
        printBackground: true,
        preferCSSPageSize: true,
      });
      writeExport(result.filePath, pdf);
      return { filePath: result.filePath };
    },
  );
  ipcMain.handle(
    IPC.screenExcel,
    async (event, request: ScreenExcelRequest): Promise<PrintResult> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const defaultPath = `${request.defaultName}.xlsx`;
      const result = window
        ? await dialog.showSaveDialog(window, { defaultPath })
        : await dialog.showSaveDialog({ defaultPath });
      if (result.canceled || !result.filePath) return { filePath: null };
      writeExport(result.filePath, toScreenWorkbook(request.sheets));
      return { filePath: result.filePath };
    },
  );
  ipcMain.handle(IPC.windowClose, (event) =>
    BrowserWindow.fromWebContents(event.sender)?.close(),
  );
}

const AUTO_BACKUP_KEEP = 10;

/** 起動のたびに、その日の控えを1つ残す（古い控えは10日分まで） */
function keepAutoBackup(dbFile: string): void {
  if (!existsSync(dbFile)) return;
  const folder = join(dirname(dbFile), "自動バックアップ");
  try {
    mkdirSync(folder, { recursive: true });
    const today = join(folder, autoBackupFileName(new Date()));
    if (!existsSync(today)) copyFileSync(dbFile, today);
    for (const name of expiredAutoBackups(
      readdirSync(folder),
      AUTO_BACKUP_KEEP,
    )) {
      rmSync(join(folder, name), { force: true });
    }
  } catch {
    // 控えを作れなくても、ソフトは起動する
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId("jp.billswork.sekisan");
  app.on("browser-window-created", (_, window) =>
    optimizer.watchWindowShortcuts(window),
  );

  const dbFile = join(app.getPath("userData"), "sekisan.db");
  keepAutoBackup(dbFile);
  initDatabase(dbFile);
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", closeDatabase);
