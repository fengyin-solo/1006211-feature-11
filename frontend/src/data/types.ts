/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
  // 越权、重复等冲突的机器可读归类，页面可据此高亮提示。
  code?: 'OWNERSHIP' | 'SCOPE' | 'AUTH_EXPIRED' | 'DUP' | 'VALIDATION'
}

// 闸门归属：操作范围是闸门自身允许执行的动作白名单（按业务名登记）。
export type GateScope = 'open' | 'open-close' | 'all'

export type GateAuth = {
  id: number
  gateId: number
  fromCrew: string
  toCrew: string
  beginAt: string
  expireAt: string
  grantedBy: string
  reason: string
  revoked: boolean
  revokedAt?: string
}

export type GateLedgerEntry = {
  id: number
  gateId: string
  gateNo: string
  action: '开启闸门' | '关闭闸门' | '登记故障'
  result: 'accepted' | 'rejected'
  rejectCode?: 'OWNERSHIP' | 'SCOPE' | 'AUTH_EXPIRED' | 'DUP' | 'VALIDATION'
  operator: string
  operatorCrew: string
  // 操作归属始终记闸门的原责任班组，借权期间也不改归属。
  ownerCrew: string
  openingAfter: number
  statusAfter: string
  operatedAt: string
  viaAuth?: boolean
  source?: 'live' | 'history-backfill'
  note?: string
}

export type CleanLedgerEntry = {
  id: number
  rackId: number
  rackNo: string
  gateNo: string
  operator: string
  crew: string
  cleanedAt: string
  source?: 'live' | 'history-backfill'
  note?: string
}

export type ReportItem = {
  id: string
  kind: 'conflict' | 'backfill' | 'missing'
  module: string
  target: string
  detail: string
  resolvedValue?: string
  happenedAt: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
