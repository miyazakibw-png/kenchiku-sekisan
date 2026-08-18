import { join } from 'path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { closeDatabase, getDatabase, initDatabase } from './db'
import { listDetails, listMasterOptions, saveDetails } from './services/detailService'
import {
  buildItemFromDetail,
  listAssemblies,
  listAssemblyMasterOptions,
  mergeAssemblies,
  promoteAssemblyToBasic,
  saveAssembly
} from './services/assemblyService'
import {
  copyProject,
  createProject,
  listProjectLedger,
  reorderProjects,
  saveProject,
  saveProjectFields
} from './services/projectService'
import { listSubjects, saveSubjects } from './services/subjectService'
import { IPC } from '../shared/ipc'
import type {
  ProjectField,
  SaveAssemblyRequest,
  SaveDetailsRequest,
  SaveProjectRequest,
  SubjectDraft
} from '../shared/types'

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    title: '建築積算システム',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  window.on('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC.masterOptions, () => listMasterOptions(getDatabase()))
  ipcMain.handle(IPC.subjectsList, () => listSubjects(getDatabase()))
  ipcMain.handle(IPC.subjectsSave, (_event, rows: SubjectDraft[]) =>
    saveSubjects(getDatabase(), rows)
  )
  ipcMain.handle(IPC.detailsList, (_event, subjectId: number) =>
    listDetails(getDatabase(), subjectId)
  )
  ipcMain.handle(IPC.detailsSave, (_event, request: SaveDetailsRequest) =>
    saveDetails(getDatabase(), request)
  )
  ipcMain.handle(IPC.assemblyOptions, () => listAssemblyMasterOptions(getDatabase()))
  ipcMain.handle(IPC.assemblyList, (_event, projectId: number | null) =>
    listAssemblies(getDatabase(), projectId)
  )
  ipcMain.handle(IPC.assemblySave, (_event, request: SaveAssemblyRequest) =>
    saveAssembly(getDatabase(), request)
  )
  ipcMain.handle(IPC.assemblyItemFromDetail, (_event, detailId: number) =>
    buildItemFromDetail(getDatabase(), detailId)
  )
  ipcMain.handle(IPC.assemblyMerge, (_event, keepId: number, mergedId: number) =>
    mergeAssemblies(getDatabase(), keepId, mergedId)
  )
  ipcMain.handle(IPC.assemblyPromote, (_event, id: number) =>
    promoteAssemblyToBasic(getDatabase(), id)
  )
  ipcMain.handle(IPC.projectLedger, () => listProjectLedger(getDatabase()))
  ipcMain.handle(IPC.projectCreate, (_event, name: string) => createProject(getDatabase(), name))
  ipcMain.handle(IPC.projectCopy, (_event, sourceId: number, name: string) =>
    copyProject(getDatabase(), sourceId, name)
  )
  ipcMain.handle(IPC.projectSave, (_event, request: SaveProjectRequest) =>
    saveProject(getDatabase(), request)
  )
  ipcMain.handle(IPC.projectReorder, (_event, orderedIds: number[]) =>
    reorderProjects(getDatabase(), orderedIds)
  )
  ipcMain.handle(IPC.projectFieldsSave, (_event, fields: ProjectField[]) =>
    saveProjectFields(getDatabase(), fields)
  )
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('jp.billswork.sekisan')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  initDatabase(join(app.getPath('userData'), 'sekisan.db'))
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', closeDatabase)
