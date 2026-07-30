export const IPC = {
  masterOptions: 'master:options',
  detailsList: 'details:list',
  detailsSave: 'details:save',
  assemblyOptions: 'assembly:options',
  assemblyList: 'assembly:list',
  assemblySave: 'assembly:save',
  assemblyDelete: 'assembly:delete',
  assemblyPromote: 'assembly:promote'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
