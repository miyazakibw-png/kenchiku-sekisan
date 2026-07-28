export const IPC = {
  masterOptions: 'master:options',
  detailsList: 'details:list',
  detailsSave: 'details:save'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
