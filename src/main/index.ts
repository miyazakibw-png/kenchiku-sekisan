import { join } from "path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { closeDatabase, getDatabase, initDatabase } from "./db";
import {
  listDetails,
  listMasterOptions,
  saveDetails,
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
  listProjectLedger,
  reorderProjects,
  saveProject,
  saveProjectFields,
} from "./services/projectService";
import { listSubjects, saveSubjects } from "./services/subjectService";
import { listFittings, saveFittings } from "./services/fittingService";
import {
  listEstimateRows,
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
import { IPC } from "../shared/ipc";
import type {
  ProjectField,
  SaveAssemblyRequest,
  SaveDetailsRequest,
  SaveEstimateRowsRequest,
  SaveFittingsRequest,
  SaveFrameSheetRequest,
  SaveGeneralSheetRequest,
  SaveProjectRequest,
  SaveRoomSheetRequest,
  SubjectDraft,
} from "../shared/types";

/** 物件ごとに独立したウィンドウで開けるようにする（複数物件の同時作業用） */
function createWindow(projectId?: number): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    title: "建築積算システム",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
    },
  });

  window.on("ready-to-show", () => window.show());
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

function registerIpcHandlers(): void {
  ipcMain.handle(IPC.masterOptions, () => listMasterOptions(getDatabase()));
  ipcMain.handle(IPC.subjectsList, () => listSubjects(getDatabase()));
  ipcMain.handle(IPC.subjectsSave, (_event, rows: SubjectDraft[]) =>
    saveSubjects(getDatabase(), rows),
  );
  ipcMain.handle(IPC.estimateRowsList, (_event, projectId: number) =>
    listEstimateRows(getDatabase(), projectId),
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
    ) => registerRoomFitting(getDatabase(), projectId, fitting),
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
  ipcMain.handle(IPC.detailsList, (_event, subjectId: number) =>
    listDetails(getDatabase(), subjectId),
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
  ipcMain.handle(IPC.windowClose, (event) =>
    BrowserWindow.fromWebContents(event.sender)?.close(),
  );
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId("jp.billswork.sekisan");
  app.on("browser-window-created", (_, window) =>
    optimizer.watchWindowShortcuts(window),
  );

  initDatabase(join(app.getPath("userData"), "sekisan.db"));
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
