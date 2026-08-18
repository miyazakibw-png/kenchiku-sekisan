export const IPC = {
  masterOptions: 'master:options',
  subjectsList: 'subjects:list',
  subjectsSave: 'subjects:save',
  detailsList: 'details:list',
  detailsSave: 'details:save',
  assemblyOptions: 'assembly:options',
  assemblyList: 'assembly:list',
  assemblySave: 'assembly:save',
  assemblyItemFromDetail: 'assembly:itemFromDetail',
  assemblyMerge: 'assembly:merge',
  assemblyPromote: 'assembly:promote',
  projectLedger: 'project:ledger',
  projectCreate: 'project:create',
  projectCopy: 'project:copy',
  projectSave: 'project:save',
  projectReorder: 'project:reorder',
  projectFieldsSave: 'project:fieldsSave'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
