export const IPC = {
  masterOptions: 'master:options',
  detailsList: 'details:list',
  detailsSave: 'details:save',
  assemblyOptions: 'assembly:options',
  assemblyList: 'assembly:list',
  assemblySave: 'assembly:save',
  assemblyItemFromDetail: 'assembly:itemFromDetail',
  assemblyMerge: 'assembly:merge',
  assemblyPromote: 'assembly:promote'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
