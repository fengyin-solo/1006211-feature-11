import { getDomain, listRows, saveDomain, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  CleanLedgerEntry,
  EntryRow,
  GateAuth,
  GateLedgerEntry,
  ReportItem,
} from '@/data/types'
import { DUP_WINDOW_MS } from './constants'
import { formatTime, nowMs, nowText, parseTime } from './time'
import { SCOPE_LABELS } from './bootstrap'

// 闸门领域服务：归属、操作范围、临时授权、操作台账、重复拦截、跨页口径同步、对账对齐都在这里收口。
// 纯前端单机模型下，同一 JS 线程内的写入天然串行；跨标签页并发靠 getDomain() 每次重读 localStorage
// + 业务键判重来保证「同一时刻并发写入只保留一笔」。

const LAST_STATUS: Record<string, string> = {
  gate: '故障',
  flood: '已结束',
}

function gates(): EntryRow[] {
  return listRows('gate')
}

function saveGates(rows: EntryRow[]): void {
  saveRows('gate', rows)
}

function nextId(rows: { id: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
}

// ---- 授权 ----

function isAuthActive(auth: GateAuth, at = nowMs()): boolean {
  if (auth.revoked) {
    return false
  }
  const begin = parseTime(auth.beginAt)
  const expire = parseTime(auth.expireAt)
  return at >= begin && at <= expire
}

export type AuthView = GateAuth & { active: boolean; state: '有效' | '已到期' | '已收回' }

export function listAuths(): AuthView[] {
  const { gateAuth } = getDomain()
  const auths = gateAuth as unknown as GateAuth[]
  return auths
    .slice()
    .sort((a, b) => parseTime(b.expireAt) - parseTime(a.expireAt))
    .map((auth) => {
      const active = isAuthActive(auth)
      return {
        ...auth,
        active,
        state: auth.revoked ? '已收回' : active ? '有效' : '已到期',
      }
    })
}

export function grantAuth(input: {
  gateId: number
  toCrew: string
  beginAt: string
  expireAt: string
  grantedBy: string
  reason: string
  fromCrew: string
}): ActionResult {
  const gate = gates().find((row) => Number(row.id) === input.gateId)
  if (!gate) {
    return { ok: false, code: 'VALIDATION', message: '没有找到对应闸门，无法授权' }
  }
  if (!input.toCrew || input.toCrew === gate.责任班组) {
    return { ok: false, code: 'VALIDATION', message: '借用班组必须与责任班组不同' }
  }
  const begin = parseTime(input.beginAt)
  const expire = parseTime(input.expireAt)
  if (Number.isNaN(begin) || Number.isNaN(expire) || expire <= begin) {
    return { ok: false, code: 'VALIDATION', message: '授权起止时间不合法（到期时间必须晚于开始时间）' }
  }
  const domain = getDomain()
  const auths = domain.gateAuth as unknown as GateAuth[]
  // 同一扇闸门、同一借入班组已有有效授权时，按重复处理，只认第一条。
  const dup = auths.find(
    (item) =>
      item.gateId === input.gateId &&
      item.toCrew === input.toCrew &&
      !item.revoked &&
      parseTime(item.expireAt) > nowMs() &&
      parseTime(item.beginAt) < expire,
  )
  if (dup) {
    return { ok: false, code: 'DUP', message: `该班组对${gate.闸门编号}已有有效临时授权（${dup.beginAt} 至 ${dup.expireAt}），重复授权已拒绝` }
  }
  const auth: GateAuth = {
    id: nextId(auths),
    gateId: input.gateId,
    fromCrew: input.fromCrew,
    toCrew: input.toCrew,
    beginAt: input.beginAt,
    expireAt: input.expireAt,
    grantedBy: input.grantedBy,
    reason: input.reason || '调班借用操作权',
    revoked: false,
  }
  saveDomain({ ...domain, gateAuth: [...auths, auth] as unknown as typeof domain.gateAuth })
  return { ok: true, message: `已授权${input.toCrew}在 ${input.beginAt} 至 ${input.expireAt} 操作${gate.闸门编号}，到期自动收回` }
}

export function revokeAuth(authId: number, operator: string): ActionResult {
  const domain = getDomain()
  const auths = domain.gateAuth as unknown as GateAuth[]
  const index = auths.findIndex((item) => item.id === authId)
  if (index < 0) {
    return { ok: false, code: 'VALIDATION', message: '没有找到该授权' }
  }
  const auth = auths[index]
  // 只有原授权班组（闸门责任班组）能收回。
  const gate = gates().find((row) => Number(row.id) === auth.gateId)
  if (gate && gate.责任班组 !== operator) {
    return {
      ok: false,
      code: 'OWNERSHIP',
      message: `归属冲突：${auth.fromCrew}是${gate.闸门编号}的责任班组，临时授权只能由${auth.fromCrew}收回，${operator}无权操作`,
    }
  }
  if (auth.revoked) {
    return { ok: false, code: 'DUP', message: '该授权已经收回，请勿重复操作' }
  }
  const updated = { ...auth, revoked: true, revokedAt: nowText() }
  const next = auths.slice()
  next[index] = updated
  saveDomain({ ...domain, gateAuth: next as unknown as typeof domain.gateAuth })
  return { ok: true, message: `已提前收回${auth.toCrew}对该闸门的临时操作权` }
}

// ---- 归属与操作范围判定 ----

export type PermissionResult = {
  allowed: boolean
  viaAuth: boolean
  auth?: GateAuth
  reason?: string
  code?: 'OWNERSHIP' | 'AUTH_EXPIRED'
}

export function canOperateGate(gate: EntryRow, crew: string, at = nowMs()): PermissionResult {
  const owner = String(gate.责任班组 ?? '')
  if (crew === owner) {
    return { allowed: true, viaAuth: false }
  }
  const { gateAuth } = getDomain()
  const auths = gateAuth as unknown as GateAuth[]
  const match = auths.find(
    (item) =>
      item.gateId === Number(gate.id) &&
      item.toCrew === crew &&
      item.fromCrew === owner,
  )
  if (!match) {
    return {
      allowed: false,
      viaAuth: false,
      code: 'OWNERSHIP',
      reason: `归属冲突：${gate.闸门编号}归属${owner}（操作范围：${gate.操作范围}），${crew}不在责任班组，也无有效临时授权，越权操作已挡回`,
    }
  }
  if (!isAuthActive(match, at)) {
    return {
      allowed: false,
      viaAuth: false,
      auth: match,
      code: 'AUTH_EXPIRED',
      reason: `归属冲突：${crew}对${gate.闸门编号}的临时授权已于 ${match.expireAt} 到期，操作权已自动收回`,
    }
  }
  return { allowed: true, viaAuth: true, auth: match }
}

const ACTION_SCOPE: Record<string, 'open' | 'close' | 'fault'> = {
  开启闸门: 'open',
  关闭闸门: 'close',
  登记故障: 'fault',
}

function scopeAllows(gate: EntryRow, action: string): boolean {
  const label = String(gate.操作范围 ?? '')
  const need = ACTION_SCOPE[action]
  if (need === 'open') {
    return label !== '' // 三种范围都允许开启
  }
  if (need === 'close') {
    return label === SCOPE_LABELS['open-close'] || label === SCOPE_LABELS.all
  }
  // 故障登记
  return label === SCOPE_LABELS.all
}

// ---- 操作台账 ----

export function listGateLedger(gateId?: number): GateLedgerEntry[] {
  const { gateLedger } = getDomain()
  const rows = gateLedger as unknown as GateLedgerEntry[]
  return rows
    .filter((row) => gateId === undefined || row.gateId === String(gateId))
    .sort((a, b) => parseTime(b.operatedAt) - parseTime(a.operatedAt))
}

function appendLedger(entry: Omit<GateLedgerEntry, 'id'>): GateLedgerEntry {
  const domain = getDomain()
  const rows = domain.gateLedger as unknown as GateLedgerEntry[]
  const full: GateLedgerEntry = { ...entry, id: nextId(rows) }
  saveDomain({ ...domain, gateLedger: [...rows, full] as unknown as typeof domain.gateLedger })
  return full
}

function isDuplicate(gateId: number, action: string, at: number): boolean {
  const rows = listGateLedger(gateId).filter((row) => row.result === 'accepted')
  return rows.some(
    (row) =>
      row.action === action &&
      Math.abs(parseTime(row.operatedAt) - at) <= DUP_WINDOW_MS,
  )
}

const TARGET_STATUS: Record<string, string> = {
  开启闸门: '运行中',
  关闭闸门: '已关闭',
  登记故障: '故障',
}

// ---- 闸门启闭（唯一写入口）----

export function operateGate(input: {
  gateId: number
  action: string
  operator: string
  crew: string
  opening?: number
}): ActionResult {
  const target = TARGET_STATUS[input.action]
  if (!target) {
    return { ok: false, code: 'VALIDATION', message: `闸门没有登记「${input.action}」这个动作` }
  }
  const rows = gates()
  const index = rows.findIndex((row) => Number(row.id) === input.gateId)
  if (index < 0) {
    return { ok: false, code: 'VALIDATION', message: `没有找到编号为 ${input.gateId} 的闸门` }
  }
  const gate = rows[index]
  const at = nowMs()
  const atText = formatTime(at)
  const ownerCrew = String(gate.责任班组)
  const denyNote = (code: 'OWNERSHIP' | 'AUTH_EXPIRED', message: string, via: boolean, auth?: GateAuth) => {
    appendLedger({
      gateId: String(gate.id),
      gateNo: String(gate.闸门编号),
      action: input.action as GateLedgerEntry['action'],
      result: 'rejected',
      rejectCode: code,
      operator: input.operator,
      operatorCrew: input.crew,
      ownerCrew,
      openingAfter: Number(gate.当前开度) || 0,
      statusAfter: String(gate.status),
      operatedAt: atText,
      viaAuth: via,
      note: message,
    })
    void auth
    return { ok: false, code, message }
  }

  // 1) 归属：只认责任班组与其有效临时授权。
  const permission = canOperateGate(gate, input.crew, at)
  if (!permission.allowed) {
    return denyNote(permission.code ?? 'OWNERSHIP', permission.reason ?? '越权操作已挡回', false, permission.auth)
  }
  // 2) 操作范围：闸门自身登记的允许动作。
  if (!scopeAllows(gate, input.action)) {
    const message = `操作范围冲突：${gate.闸门编号}登记的操作范围为「${gate.操作范围}」，不含「${input.action}」，已挡回`
    appendLedger({
      gateId: String(gate.id), gateNo: String(gate.闸门编号),
      action: input.action as GateLedgerEntry['action'], result: 'rejected', rejectCode: 'SCOPE',
      operator: input.operator, operatorCrew: input.crew, ownerCrew,
      openingAfter: Number(gate.当前开度) || 0, statusAfter: String(gate.status),
      operatedAt: atText, viaAuth: permission.viaAuth, note: message,
    })
    return { ok: false, code: 'SCOPE', message }
  }
  // 3) 同一时段重复操作：同一闸门同一动作窗口内只认第一条；同一时刻并发也在此被挡。
  if (isDuplicate(Number(gate.id), input.action, at)) {
    const message = `重复操作：${gate.闸门编号}在近5分钟内已有一条「${input.action}」被受理，同一时段只认第一条，后到的已按重复拒绝`
    appendLedger({
      gateId: String(gate.id), gateNo: String(gate.闸门编号),
      action: input.action as GateLedgerEntry['action'], result: 'rejected', rejectCode: 'DUP',
      operator: input.operator, operatorCrew: input.crew, ownerCrew,
      openingAfter: Number(gate.当前开度) || 0, statusAfter: String(gate.status),
      operatedAt: atText, viaAuth: permission.viaAuth, note: message,
    })
    return { ok: false, code: 'DUP', message }
  }

  let opening = Number(gate.当前开度) || 0
  if (input.action === '开启闸门') {
    opening = input.opening === undefined ? Math.max(opening, 100) : Number(input.opening)
    if (!Number.isFinite(opening) || opening <= 0 || opening > 100) {
      return { ok: false, code: 'VALIDATION', message: '开启开度需为 1—100 之间的百分数' }
    }
  }
  if (input.action === '关闭闸门') {
    opening = 0
  }

  const updated: EntryRow = {
    ...gate,
    status: target,
    pending: target !== LAST_STATUS.gate,
    abnormal: target === '故障',
    当前开度: opening,
    // 操作人员记实际动手的人；归属仍在责任班组列，借权期间也不变。
    操作人员: permission.viaAuth ? `${input.operator}(借权)` : input.operator,
    操作时间: atText,
    闸门状态: target,
    _updatedAt: atText,
  }
  const next = rows.slice()
  next[index] = updated
  saveGates(next)
  appendLedger({
    gateId: String(gate.id), gateNo: String(gate.闸门编号),
    action: input.action as GateLedgerEntry['action'], result: 'accepted',
    operator: input.operator, operatorCrew: input.crew, ownerCrew,
    openingAfter: opening, statusAfter: target, operatedAt: atText,
    viaAuth: permission.viaAuth,
    note: permission.viaAuth
      ? `临时授权期间操作，操作记录归属仍记${ownerCrew}`
      : undefined,
  })

  // 4) 开启孔数口径同步：闸门开度变化立即回灌泄洪页最新票。
  syncFloodFromGates(atText)
  return {
    ok: true,
    message: `${gate.闸门编号}已${input.action}，当前开度 ${opening}%，状态「${target}」；操作归属：${ownerCrew}${permission.viaAuth ? `（${input.crew}借权操作）` : ''}；泄洪孔数已同步`,
  }
}

// ---- 归属登记修改：只有责任班组能改自己的闸门 ----

export function updateOwnership(input: {
  gateId: number
  crew: string
  operator: string
  ownerCrew: string
  scope?: string
}): ActionResult {
  const rows = gates()
  const index = rows.findIndex((row) => Number(row.id) === input.gateId)
  if (index < 0) {
    return { ok: false, code: 'VALIDATION', message: '没有找到对应闸门' }
  }
  const gate = rows[index]
  if (String(gate.责任班组) !== input.crew) {
    return {
      ok: false,
      code: 'OWNERSHIP',
      message: `归属冲突：${gate.闸门编号}归属${gate.责任班组}，归属登记只允许责任班组修改，${input.crew}为只读，已拒绝`,
    }
  }
  if (input.scope !== undefined && !Object.values(SCOPE_LABELS).includes(input.scope)) {
    return { ok: false, code: 'VALIDATION', message: '操作范围取值不合法' }
  }
  const atText = nowText()
  const updated: EntryRow = {
    ...gate,
    责任班组: input.ownerCrew,
    ...(input.scope !== undefined ? { 操作范围: input.scope } : {}),
    操作人员: `${input.operator}(归属变更)`,
    操作时间: atText,
    _updatedAt: atText,
  }
  const next = rows.slice()
  next[index] = updated
  saveGates(next)
  return { ok: true, message: `归属已更新：${gate.闸门编号}责任班组变更为${input.ownerCrew}${input.scope ? `，操作范围为「${input.scope}」` : ''}` }
}

// ---- 泄洪孔数口径：闸门开度 → 开启孔数（单一口径，两页读同一个数）----

export function openHoleCountByGroup(): Record<string, number> {
  const result: Record<string, number> = {}
  for (const gate of gates()) {
    const group = String(gate.泄洪闸组 ?? '—')
    if (group === '—') {
      continue
    }
    if (Number(gate.当前开度) > 0) {
      result[group] = (result[group] ?? 0) + 1
    }
  }
  return result
}

export function totalOpenHoles(): number {
  return Object.values(openHoleCountByGroup()).reduce((sum, value) => sum + value, 0)
}

// 闸门变化后把开启孔数与状态同步到泄洪页每个闸组的最新票；返回被对齐的票（便于留争议报告）。
export function syncFloodFromGates(atText = nowText()): { group: string; row: EntryRow; storedHoles: number; actualHoles: number }[] {
  const floods = listRows('flood')
  const holes = openHoleCountByGroup()
  if (!floods.length) {
    return []
  }
  const latestIndexByGroup = new Map<string, number>()
  floods.forEach((row, index) => {
    const group = String(row.泄洪闸号)
    const prev = latestIndexByGroup.get(group)
    if (prev === undefined || parseTime(String(row.操作时间)) > parseTime(String(floods[prev].操作时间))) {
      latestIndexByGroup.set(group, index)
    }
  })
  const next = floods.slice()
  const changed: { group: string; row: EntryRow; storedHoles: number; actualHoles: number }[] = []
  for (const [group, index] of latestIndexByGroup) {
    const openHoles = holes[group] ?? 0
    const row = next[index]
    if (String(row.操作状态) === '已结束') {
      continue // 历史已终结票不改，只由显式对账产出冲突报告
    }
    const storedHoles = Number(row.开启孔数) || 0
    const status = openHoles > 0 ? '泄洪中' : '已批准'
    if (storedHoles === openHoles && String(row.status) === status) {
      continue
    }
    changed.push({ group, row, storedHoles, actualHoles: openHoles })
    next[index] = {
      ...row,
      开启孔数: openHoles,
      status,
      操作状态: status,
      pending: status !== LAST_STATUS.flood,
      _updatedAt: atText,
    }
  }
  saveRows('flood', next)
  return changed
}

// ---- 拦污栅台账：清污条数由共享台账派生，闸门页读到同一个数 ----

export function cleanCountByGate(): Record<string, number> {
  const { cleanLedger } = getDomain()
  const rows = cleanLedger as unknown as CleanLedgerEntry[]
  const result: Record<string, number> = {}
  for (const row of rows) {
    result[row.gateNo] = (result[row.gateNo] ?? 0) + 1
  }
  return result
}

export function cleanCountByRack(): Record<number, number> {
  const { cleanLedger } = getDomain()
  const rows = cleanLedger as unknown as CleanLedgerEntry[]
  const result: Record<number, number> = {}
  for (const row of rows) {
    result[row.rackId] = (result[row.rackId] ?? 0) + 1
  }
  return result
}

export function listCleanLedger(): CleanLedgerEntry[] {
  const { cleanLedger } = getDomain()
  return (cleanLedger as unknown as CleanLedgerEntry[])
    .slice()
    .sort((a, b) => parseTime(b.cleanedAt) - parseTime(a.cleanedAt))
}

export function recordCleaning(input: {
  rackId: number
  operator: string
  crew: string
}): ActionResult {
  const racks = listRows('trashrack')
  const index = racks.findIndex((row) => Number(row.id) === input.rackId)
  if (index < 0) {
    return { ok: false, code: 'VALIDATION', message: '没有找到对应拦污栅' }
  }
  const rack = racks[index]
  const at = nowMs()
  const atText = formatTime(at)
  const domain = getDomain()
  const ledger = domain.cleanLedger as unknown as CleanLedgerEntry[]
  // 同一时刻/同一时段同一栅体重复提交只保留一笔。
  const dup = ledger.some(
    (row) =>
      row.rackId === input.rackId &&
      Math.abs(parseTime(row.cleanedAt) - at) <= DUP_WINDOW_MS,
  )
  if (dup) {
    return { ok: false, code: 'DUP', message: `重复提交：${rack.栅体编号}近5分钟内已登记清污，只保留第一笔，后到的按重复拒绝` }
  }
  const entry: CleanLedgerEntry = {
    id: nextId(ledger),
    rackId: input.rackId,
    rackNo: String(rack.栅体编号),
    gateNo: String(rack.关联闸门 ?? ''),
    operator: input.operator,
    crew: input.crew,
    cleanedAt: atText,
  }
  const count = ledger.filter((row) => row.rackId === input.rackId).length + 1
  const updated: EntryRow = {
    ...rack,
    status: '已清理',
    pending: false,
    abnormal: false,
    清污次数: count,
    清理日期: atText.slice(0, 10),
    清理人员: input.operator,
    栅体状态: '已清理',
    _updatedAt: atText,
  }
  const nextRacks = racks.slice()
  nextRacks[index] = updated
  saveRows('trashrack', nextRacks)
  saveDomain({ ...domain, cleanLedger: [...ledger, entry] as unknown as typeof domain.cleanLedger })
  return { ok: true, message: `${rack.栅体编号}清污已登记，台账累计 ${count} 条，已同步到闸门页与拦污栅台账` }
}

// ---- 对账：两套取值有争议时，以较晚产生的为准并统一过来 ----

export function listReports(): ReportItem[] {
  const { reports } = getDomain()
  return (reports as unknown as ReportItem[]).slice().sort((a, b) => parseTime(b.happenedAt) - parseTime(a.happenedAt))
}

function saveReports(items: ReportItem[]): void {
  const domain = getDomain()
  saveDomain({ ...domain, reports: items as unknown as typeof domain.reports })
}

function pushReport(items: ReportItem[], item: ReportItem): void {
  if (!items.some((row) => row.id === item.id)) {
    items.push(item)
  }
}

// 扫描缺失字段：历史数据按业务日期补数，无法推断的事实字段单独罗列。
function collectMissing(items: ReportItem[]): void {
  const check = (module: string, rows: EntryRow[], fields: string[]) => {
    for (const row of rows) {
      for (const field of fields) {
        const value = String(row[field] ?? '').trim()
        if (value === '' || value === '—' || value === '待补' || value.includes('样例')) {
          pushReport(items, {
            id: `missing-${module}-${row.id}-${field}`,
            kind: 'missing',
            module,
            target: String(row[Object.keys(row).find((key) => key.endsWith('编号')) ?? 'id'] ?? row.id),
            detail: `字段「${field}」缺失，历史补数未能推断，需${module === '闸门启闭' ? '该闸门责任班组' : '责任班组'}补录`,
            happenedAt: nowText(),
          })
        }
      }
    }
  }
  check('闸门启闭', gates(), ['孔口尺寸', '启闭机型号', '操作人员'])
  check('泄洪操作', listRows('flood').filter((row) => String(row.status) !== '已结束'), ['操作人员'])
  check('拦污栅', listRows('trashrack').filter((row) => String(row.status) === '已清理'), ['清污方式', '清理人员'])
}

// 一次性对齐：闸门快照↔台账、泄洪孔数↔闸门开度、拦污栅次数↔清污台账。
export function reconcile(): ReportItem[] {
  const items: ReportItem[] = []
  const atText = nowText()

  // 1) 闸门：以较晚产生的取值（操作台账最新受理条目）为准，统一快照。
  for (const gate of gates()) {
    const latest = listGateLedger(Number(gate.id)).find((row) => row.result === 'accepted')
    if (!latest) {
      continue
    }
    const snapshotTime = parseTime(String(gate._updatedAt ?? gate.操作时间 ?? ''))
    const ledgerTime = parseTime(latest.operatedAt)
    const snapshotOpening = Number(gate.当前开度) || 0
    if (ledgerTime >= snapshotTime && (snapshotOpening !== latest.openingAfter || String(gate.status) !== latest.statusAfter)) {
      const rows = gates().map((row) =>
        Number(row.id) === Number(gate.id)
          ? {
              ...row,
              status: latest.statusAfter,
              闸门状态: latest.statusAfter,
              当前开度: latest.openingAfter,
              pending: latest.statusAfter !== LAST_STATUS.gate,
              abnormal: latest.statusAfter === '故障',
              操作人员: latest.operator.includes('历史补记') ? latest.operator : row.操作人员,
              操作时间: latest.operator.includes('历史补记') && !String(row.操作人员).includes('借权') ? latest.operatedAt : row.操作时间,
              _updatedAt: atText,
            }
          : row,
      )
      saveGates(rows)
      pushReport(items, {
        id: `conflict-gate-${gate.id}-${latest.id}`,
        kind: 'conflict',
        module: '闸门启闭',
        target: String(gate.闸门编号),
        detail: `闸门快照（开度${snapshotOpening}%/${gate.status}，更新于${gate._updatedAt ?? gate.操作时间}）与操作台账最新值（开度${latest.openingAfter}%/${latest.statusAfter}，${latest.operatedAt}）并存且有争议，以较晚产生的台账取值为准并统一`,
        resolvedValue: `开度${latest.openingAfter}%，${latest.statusAfter}`,
        happenedAt: atText,
      })
    }
  }

  // 2) 泄洪：先按同步前快照记下争议，再以较晚的闸门操作为准统一孔数与状态。
  const holes = openHoleCountByGroup()
  const floodsBefore = listRows('flood')
  const latestByGroup = new Map<string, EntryRow>()
  for (const row of floodsBefore) {
    const group = String(row.泄洪闸号)
    const prev = latestByGroup.get(group)
    if (!prev || parseTime(String(row.操作时间)) > parseTime(String(prev.操作时间))) {
      latestByGroup.set(group, row)
    }
  }
  for (const [group, row] of latestByGroup) {
    if (String(row.操作状态) === '已结束') {
      continue
    }
    const openHoles = holes[group] ?? 0
    const stored = Number(row.开启孔数) || 0
    if (stored !== openHoles || (openHoles > 0 && String(row.status) !== '泄洪中')) {
      pushReport(items, {
        id: `conflict-flood-${row.id}`,
        kind: 'conflict',
        module: '泄洪操作',
        target: `${String(row.操作编号)}（${group}）`,
        detail: `泄洪票记开启孔数 ${stored}、状态「${row.status}」，闸门页实际开 ${openHoles} 孔（较晚的闸门操作为准），已统一为 ${openHoles} 孔/${openHoles > 0 ? '泄洪中' : '已批准'}，两页口径一致`,
        resolvedValue: `${openHoles} 孔`,
        happenedAt: atText,
      })
    }
  }
  syncFloodFromGates(atText)

  // 3) 拦污栅：清污次数以清污台账为准（较晚追加的一条决定取值），并同步到闸门页口径。
  const rackCounts = cleanCountByRack()
  const gateCounts = cleanCountByGate()
  const cleanRowsAll = getDomain().cleanLedger as unknown as CleanLedgerEntry[]
  const latestCleanByRack = new Map<number, CleanLedgerEntry>()
  for (const entry of cleanRowsAll) {
    const prev = latestCleanByRack.get(entry.rackId)
    if (!prev || parseTime(entry.cleanedAt) > parseTime(prev.cleanedAt)) {
      latestCleanByRack.set(entry.rackId, entry)
    }
  }
  const racks = listRows('trashrack').map((row) => {
    const id = Number(row.id)
    const actual = rackCounts[id] ?? 0
    const latest = latestCleanByRack.get(id)
    let next = row
    const detailParts: string[] = []
    if (Number(row.清污次数) !== actual) {
      detailParts.push(`清污次数 ${row.清污次数} → ${actual}`)
      next = { ...next, 清污次数: actual }
    }
    // 清理人/清理日期同样以较晚的台账记录为准，快照缺字段或取值更旧时统一过来。
    if (latest && parseTime(latest.cleanedAt) >= parseTime(String(row._updatedAt ?? ''))) {
      const latestName = latest.operator.includes('历史补记') ? '' : latest.operator
      if (latestName && String(row.清理人员 ?? '') !== latestName) {
        detailParts.push(`清理人员「${row.清理人员 ?? '空'}」→「${latestName}」`)
        next = { ...next, 清理人员: latestName }
      }
      const latestDate = latest.cleanedAt.slice(0, 10)
      if (String(row.清理日期 ?? '') !== latestDate) {
        detailParts.push(`清理日期 → ${latestDate}`)
        next = { ...next, 清理日期: latestDate }
      }
    }
    if (detailParts.length) {
      pushReport(items, {
        id: `conflict-trashrack-${row.id}`,
        kind: 'conflict',
        module: '拦污栅',
        target: String(row.栅体编号),
        detail: `拦污栅快照与清污台账并存且有争议：${detailParts.join('，')}；以较晚产生的台账取值为准并统一，跨页面（含闸门台账）条数一致为 ${actual} 条`,
        resolvedValue: `${actual} 条`,
        happenedAt: atText,
      })
    }
    return next
  })
  saveRows('trashrack', racks)
  // 闸门页侧无快照字段，cleanCountByGate() 直接读台账，天然一致；仅输出一条同步说明。
  for (const [gateNo, count] of Object.entries(gateCounts)) {
    pushReport(items, {
      id: `sync-gate-clean-${gateNo}`,
      kind: 'conflict',
      module: '闸门启闭',
      target: gateNo,
      detail: `闸门台账清污条数读自拦污栅清污台账：${gateNo} 关联拦污栅累计清污 ${count} 条，跨页同一口径`,
      resolvedValue: `${count} 条`,
      happenedAt: atText,
    })
  }

  // 4) 历史补数说明：台账里按业务日期回填、无操作人的按责任班组补记。
  const ledger = getDomain().gateLedger as unknown as GateLedgerEntry[]
  for (const row of ledger.filter((item) => item.source === 'history-backfill')) {
    pushReport(items, {
      id: `backfill-gate-${row.id}`,
      kind: 'backfill',
      module: '闸门启闭',
      target: row.gateNo,
      detail: `历史操作按业务日期 ${row.operatedAt.slice(0, 10)} 回填；该记录无操作人，按闸门责任班组「${row.ownerCrew}」补记`,
      resolvedValue: row.operator,
      happenedAt: row.operatedAt,
    })
  }
  const cleanRows = getDomain().cleanLedger as unknown as CleanLedgerEntry[]
  for (const row of cleanRows.filter((item) => item.source === 'history-backfill')) {
    pushReport(items, {
      id: `backfill-clean-${row.id}`,
      kind: 'backfill',
      module: '拦污栅',
      target: row.rackNo,
      detail: `历史清污按业务日期 ${row.cleanedAt.slice(0, 10)} 回填；无清理人，按清污责任班组「${row.crew}」补记`,
      resolvedValue: row.operator,
      happenedAt: row.cleanedAt,
    })
  }

  collectMissing(items)

  // 报告与条目同存：历史报告保留，新增按 id 去重。
  const previous = listReports()
  const merged = [...previous]
  for (const item of items) {
    pushReport(merged, item)
  }
  saveReports(merged)
  return merged
}
