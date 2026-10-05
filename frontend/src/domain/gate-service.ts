import { listRows, listTable, nextId, saveRows, saveTable } from '@/data/local-store'
import { businessDate, minuteSlot, now, nowIso, opTimeIso, secondBucket } from '@/data/clock'
import { canOwnGate, crewName, CREWS } from './identity'
import { withWriteLock } from './lock'
import { checkAccess, listGrants } from './ownership'
import { reconcile } from './reconcile'
import type {
  ActionResult,
  Actor,
  FloodRow,
  GateLogRow,
  GateRow,
  GrantRow,
  SyncLogRow,
} from './types'

// 闸门启闭业务：归属校验、调班授权、重复与并发拦截、操作留痕、孔数同步都在这里收口，
// 页面只负责调用与展示，不做业务判断。

const GATE_TABLE = 'gate'
const FLOOD_TABLE = 'flood'
const LOG_TABLE = 'gateLogs'
const GRANT_TABLE = 'grants'

export function listGates(): GateRow[] {
  return listRows(GATE_TABLE) as unknown as GateRow[]
}

export function listGateLogs(): GateLogRow[] {
  return listTable<GateLogRow>(LOG_TABLE).sort((a, b) => b.操作时间.localeCompare(a.操作时间))
}

function findGate(id: number): GateRow | undefined {
  return listGates().find((row) => row.id === id)
}

function appendLog(log: Omit<GateLogRow, 'id' | '时间戳Iso'>, stamp: string = nowIso()): void {
  const rows = listTable<GateLogRow>(LOG_TABLE)
  rows.push({ id: nextId(rows), 时间戳Iso: stamp, ...log })
  saveTable(LOG_TABLE, rows)
}

/** 同一扇闸门同一时段（一分钟）同方向操作只认第一条，后到的按重复拒绝。 */
function findDuplicate(gateId: number, action: string): GateLogRow | undefined {
  const slot = minuteSlot()
  return listTable<GateLogRow>(LOG_TABLE)
    .filter((log) => log.结果 !== '已拒绝')
    .find(
      (log) =>
        log.gateId === gateId &&
        log.操作类型 === action &&
        minuteSlot(new Date(log.时间戳Iso)) === slot,
    )
}

/**
 * 一个闸段「闸孔实测」这套取值的产生时间：
 * 有开启闸孔时取开启闸孔最近一次开度时间；全关时取所有闸孔最近一次开度时间（关闭动作时间）。
 * 这样已关闭闸门的历史时间不会把实测取值时间虚假顶晚。
 */
export function bayPhysicalSnapshot(bay: string): { open: number; time: string } {
  const gates = listGates().filter((item) => item.参与泄洪 && item.闸段 === bay)
  const open = gates.filter((item) => item.当前开度 > 0).length
  const openedTimes = gates
    .filter((item) => item.当前开度 > 0)
    .map((item) => item.开度更新时间 ?? opTimeIso(String(item.操作时间)))
    .sort()
  const allTimes = gates
    .map((item) => item.开度更新时间 ?? opTimeIso(String(item.操作时间)))
    .sort()
  return { open, time: (openedTimes.length ? openedTimes : allTimes).at(-1) ?? '1970-01-01T00:00:00.000Z' }
}

function denied(gate: GateRow, actor: Actor, action: string, reason: string): ActionResult {
  appendLog({
    gateId: gate.id,
    闸门编号: gate.闸门编号,
    操作类型: action,
    操作开度: gate.当前开度,
    操作时间: now().toLocaleString('zh-CN', { hour12: false }),
    实际操作人: actor.name,
    归属班组: gate.责任班组,
    操作班组: actor.crewCode,
    授权依据: '无',
    结果: '已拒绝',
    业务日期: businessDate(),
    来源: reason,
  })
  return { ok: false, message: reason }
}

function duplicateResult(gate: GateRow, actor: Actor, action: string, first: GateLogRow): ActionResult {
  const message = `重复操作已拒绝：闸门 ${gate.闸门编号} 在 ${first.操作时间} 已由 ${first.实际操作人} 发起「${action}」（归属${crewName(first.归属班组)}），同一时段只认第一条，本笔按重复处理。`
  return denied(gate, actor, action, message)
}

function recomputeBayHoles(gate: GateRow): void {
  if (!gate.参与泄洪) {
    return
  }
  const floods = listRows(FLOOD_TABLE) as unknown as FloodRow[]
  const flood = floods.find((row) => row.泄洪闸号 === gate.闸段)
  const snapshot = bayPhysicalSnapshot(gate.闸段)
  const openCount = snapshot.open

  if (!flood) {
    // 闸段还没有泄洪登记，按闸孔实际状态补一条，保证两页口径一致。
    floods.push({
      id: nextId(floods),
      操作编号: `FLOO-AUTO-${gate.闸段}`,
      泄洪闸号: gate.闸段,
      开启孔数: openCount,
      泄洪流量: 0,
      下游预警: '无',
      操作时间: now().toLocaleString('zh-CN', { hour12: false }),
      操作人员: '闸孔联动自动登记',
      操作状态: openCount > 0 ? '泄洪中' : '已结束',
      孔数更新时间: nowIso(),
      孔数来源: '闸门联动',
      status: openCount > 0 ? '泄洪中' : '已结束',
      pending: openCount > 0,
      abnormal: false,
    })
    saveRows(FLOOD_TABLE, floods as unknown as ReturnType<typeof listRows>[number][])
    return
  }

  reconcile(
    `hole:${gate.闸段}`,
    `${gate.闸段} 开启孔数`,
    '闸门实测',
    '泄洪登记',
    '孔',
    { value: openCount, time: snapshot.time },
    { value: flood.开启孔数, time: flood.孔数更新时间 },
    (winner, value) => {
      if (winner === 'A') {
        // 本次闸孔操作更晚：泄洪页孔数同步成闸孔实测，两页读到的开启孔数一致。
        flood.开启孔数 = value
        flood.孔数来源 = '闸门实测同步'
        flood.孔数更新时间 = nowIso()
        if (value > 0 && flood.操作状态 !== '泄洪中') {
          flood.操作状态 = '泄洪中'
          flood.status = '泄洪中'
        }
        if (value === 0 && flood.操作状态 === '泄洪中') {
          flood.操作状态 = '已结束'
          flood.status = '已结束'
        }
      } else {
        // 泄洪登记更晚：以调度口径为准，逐孔启闭把物理闸孔补齐（本笔操作已先落库，通常闸门侧更晚）。
        alignBayPhysical(gate.闸段, value)
      }
    },
  )
  saveRows(FLOOD_TABLE, floods as unknown as ReturnType<typeof listRows>[number][])
  // B 胜时对齐物理闸孔由 alignBayPhysical 自行落库。
}

/** 让一个闸段实际开启的闸孔数等于目标值：按编号顺序先开未开的、再关多余的。 */
export function alignBayPhysical(bay: string, targetOpen: number): void {
  const all = listGates()
  const inBay = all.filter((item) => item.参与泄洪 && item.闸段 === bay)
  const sorted = [...inBay].sort((a, b) => a.闸门编号.localeCompare(b.闸门编号))
  let openCount = sorted.filter((gate) => gate.当前开度 > 0).length
  let changed = false
  for (const item of sorted) {
    if (openCount < targetOpen && item.当前开度 === 0) {
      item.当前开度 = 1
      item.闸门状态 = '运行中'
      item.status = '运行中'
      item.开度更新时间 = nowIso()
      openCount += 1
      changed = true
    } else if (openCount > targetOpen && item.当前开度 > 0) {
      item.当前开度 = 0
      item.闸门状态 = '已关闭'
      item.status = '已关闭'
      item.开度更新时间 = nowIso()
      openCount -= 1
      changed = true
    }
  }
  if (changed) {
    saveRows(GATE_TABLE, all as unknown as ReturnType<typeof listRows>[number][])
  }
}

export type GateOperationInput = {
  gateId: number
  action: '开启闸门' | '关闭闸门'
  actor: Actor
  /** 开启时的目标开度（米/相对值），关闭时忽略 */
  opening?: number
}

/** 发起开启/关闭：归属校验 → 重复拦截 → 并发锁 → 落库留痕 → 孔数同步。 */
export function operateGate(input: GateOperationInput): ActionResult {
  const gate = findGate(input.gateId)
  if (!gate) {
    return { ok: false, message: `没有找到编号为 ${input.gateId} 的闸门` }
  }
  const { gateId, action, actor } = input

  // 1) 归属：本班组或生效授权，越权一律挡回，话术写清归属冲突。
  const access = checkAccess(gate, actor, action === '开启闸门' ? '开启' : '关闭')
  if (!access.ok) {
    return denied(gate, actor, action, access.message)
  }

  // 2) 同一时段重复：同闸同方向一分钟内只认第一条。
  const dup = findDuplicate(gateId, action)
  if (dup) {
    return duplicateResult(gate, actor, action, dup)
  }

  // 3) 同一时刻并发写入：同一秒同闸同动作只保留一笔，其余按重复处理。
  const lockKey = `gate:${gateId}:${action}:${secondBucket()}`
  const locked = withWriteLock(lockKey, () => {
    const gates = listGates()
    const index = gates.findIndex((item) => item.id === gateId)
    const current = gates[index]
    const opening = action === '开启闸门' ? Math.max(1, Math.round(Number(input.opening) || 1)) : 0
    const targetStatus = action === '开启闸门' ? '运行中' : '已关闭'

    if (action === '开启闸门' && current.当前开度 > 0) {
      return { ok: false, message: `闸门 ${current.闸门编号} 已处于开启状态（当前开度 ${current.当前开度}），无需重复开启` }
    }
    if (action === '关闭闸门' && current.当前开度 === 0) {
      return { ok: false, message: `闸门 ${current.闸门编号} 已处于关闭状态，无需重复关闭` }
    }

    const stamp = nowIso()
    const stampText = now().toLocaleString('zh-CN', { hour12: false })
    const grant = access.grant
    const basis = grant
      ? `调班临时授权：${crewName(grant.借用班组)}借用，${new Date(grant.授权到期).toLocaleString('zh-CN', { hour12: false })}到期`
      : '责任班组本人操作'

    gates[index] = {
      ...current,
      当前开度: opening,
      闸门状态: targetStatus,
      status: targetStatus,
      操作人员: actor.name,
      操作时间: stampText,
      开度更新时间: stamp,
      pending: targetStatus === '运行中',
      abnormal: false,
    }
    saveRows(GATE_TABLE, gates as unknown as ReturnType<typeof listRows>[number][])

    // 授权期间的操作记录仍归原班组：归属班组记责任班组，操作班组记实际干活的班组。
    appendLog({
      gateId,
      闸门编号: current.闸门编号,
      操作类型: action,
      操作开度: opening,
      操作时间: stampText,
      实际操作人: actor.name,
      归属班组: current.责任班组,
      操作班组: actor.crewCode,
      授权依据: basis,
      结果: targetStatus,
      业务日期: businessDate(),
      来源: grant ? `临时授权操作（记录仍归${crewName(current.责任班组)}）` : '',
    })

    // 开启后当前开度同步到泄洪孔数口径：按闸段重算开启孔数并与泄洪页对齐。
    recomputeBayHoles(gates[index])
    return { ok: true as const, message: `闸门 ${current.闸门编号} 已${action === '开启闸门' ? `开启至 ${opening}` : '关闭'}，操作记录归属${crewName(current.责任班组)}；${current.参与泄洪 ? `${current.闸段}开启孔数已同步到泄洪操作页` : '检修闸门不参与泄洪孔数统计'}` }
  })

  if (locked.locked) {
    return denied(
      gate,
      actor,
      action,
      `并发写入已拒绝：闸门 ${gate.闸门编号} 的「${action}」在同一时刻已有一笔写入，本笔按重复处理，只保留第一笔。`,
    )
  }
  return locked.value
}

/** 登记故障：只允许责任班组（借用人、其他班组、观测岗一律拒绝）。 */
export function reportGateFault(gateId: number, actor: Actor, note = ''): ActionResult {
  const gate = findGate(gateId)
  if (!gate) {
    return { ok: false, message: `没有找到编号为 ${gateId} 的闸门` }
  }
  const access = checkAccess(gate, actor, '登记故障')
  if (!access.ok) {
    return denied(gate, actor, '登记故障', access.message)
  }
  const dup = findDuplicate(gateId, '登记故障')
  if (dup) {
    return duplicateResult(gate, actor, '登记故障', dup)
  }
  const lockKey = `gate:${gateId}:登记故障:${secondBucket()}`
  const locked = withWriteLock(lockKey, () => {
    const gates = listGates()
    const index = gates.findIndex((item) => item.id === gateId)
    const stampText = now().toLocaleString('zh-CN', { hour12: false })
    gates[index] = {
      ...gates[index],
      闸门状态: '故障',
      status: '故障',
      abnormal: true,
      操作人员: actor.name,
      操作时间: stampText,
    }
    saveRows(GATE_TABLE, gates as unknown as ReturnType<typeof listRows>[number][])
    appendLog({
      gateId,
      闸门编号: gate.闸门编号,
      操作类型: '登记故障',
      操作开度: gate.当前开度,
      操作时间: stampText,
      实际操作人: actor.name,
      归属班组: gate.责任班组,
      操作班组: actor.crewCode,
      授权依据: '责任班组本人操作',
      结果: `故障${note ? `：${note}` : ''}`,
      业务日期: businessDate(),
      来源: '',
    })
    return { ok: true as const, message: `闸门 ${gate.闸门编号} 已由${crewName(gate.责任班组)}登记故障` }
  })
  if (locked.locked) {
    return denied(gate, actor, '登记故障', `并发写入已拒绝：闸门 ${gate.闸门编号} 的故障登记在同一时刻已有一笔，本笔按重复处理。`)
  }
  return locked.value
}

/** 修改归属（责任班组/操作范围）：只有当前责任班组能改，其他岗位只读。 */
export function reassignGate(
  gateId: number,
  actor: Actor,
  patch: { 责任班组?: string; 操作范围?: string },
): ActionResult {
  const gate = findGate(gateId)
  if (!gate) {
    return { ok: false, message: `没有找到编号为 ${gateId} 的闸门` }
  }
  const access = checkAccess(gate, actor, '修改归属')
  if (!access.ok) {
    return denied(gate, actor, '修改归属', access.message)
  }
  if (patch.责任班组) {
    const nextCrew = CREWS.find((crew) => crew.code === patch.责任班组)
    if (!nextCrew || !canOwnGate({ ...actor, crewCode: nextCrew.code, role: nextCrew.role })) {
      return { ok: false, message: `归属目标班组无效：观测岗不能作为闸门责任班组` }
    }
  }
  const lockKey = `gate:${gateId}:修改归属:${secondBucket()}`
  const locked = withWriteLock(lockKey, () => {
    const gates = listGates()
    const index = gates.findIndex((item) => item.id === gateId)
    const oldOwner = gates[index].责任班组
    gates[index] = {
      ...gates[index],
      责任班组: patch.责任班组 ?? gates[index].责任班组,
      操作范围: patch.操作范围 ?? gates[index].操作范围,
    }
    saveRows(GATE_TABLE, gates as unknown as ReturnType<typeof listRows>[number][])
    const stampText = now().toLocaleString('zh-CN', { hour12: false })
    appendLog({
      gateId,
      闸门编号: gate.闸门编号,
      操作类型: '修改归属',
      操作开度: gate.当前开度,
      操作时间: stampText,
      实际操作人: actor.name,
      归属班组: oldOwner,
      操作班组: actor.crewCode,
      授权依据: '责任班组本人操作',
      结果: `归属变更为${crewName(gates[index].责任班组)}／操作范围「${gates[index].操作范围}」`,
      业务日期: businessDate(),
      来源: '',
    })
    return { ok: true as const, message: `闸门 ${gate.闸门编号} 归属已调整为${crewName(gates[index].责任班组)}，操作范围「${gates[index].操作范围}」` }
  })
  if (locked.locked) {
    return denied(gate, actor, '修改归属', `并发写入已拒绝：闸门 ${gate.闸门编号} 的归属修改同一时刻只保留一笔。`)
  }
  return locked.value
}

// ---- 调班临时授权 ----

export function listGateGrants(): GrantRow[] {
  return listGrants()
}

export type GrantInput = {
  gateId: number
  borrower: Actor
  reason: string
  startIso: string
  expireIso: string
}

/** 授权也只允许责任班组发起；借用班组不能是自己，不能是观测岗，起止时间要合法。 */
export function createGrant(owner: Actor, input: GrantInput): ActionResult {
  const gate = findGate(input.gateId)
  if (!gate) {
    return { ok: false, message: `没有找到编号为 ${input.gateId} 的闸门` }
  }
  const access = checkAccess(gate, owner, '修改归属')
  if (!access.ok) {
    return { ok: false, message: access.message }
  }
  if (input.borrower.crewCode === gate.责任班组) {
    return { ok: false, message: '借用班组就是责任班组本人，无需临时授权' }
  }
  if (!canOwnGate(input.borrower)) {
    return { ok: false, message: '观测岗只有只读权限，不能被授予闸门启闭权' }
  }
  if (new Date(input.expireIso).getTime() <= new Date(input.startIso).getTime()) {
    return { ok: false, message: '授权到期时间必须晚于开始时间' }
  }
  const rows = listTable<GrantRow>(GRANT_TABLE)
  if (
    rows.some(
      (row) =>
        row.gateId === input.gateId &&
        row.借用班组 === input.borrower.crewCode &&
        row.状态 === '生效中' &&
        new Date(row.授权到期).getTime() > now().getTime(),
    )
  ) {
    return { ok: false, message: `闸门 ${gate.闸门编号} 对${crewName(input.borrower.crewCode)}已有生效中的授权，勿重复登记` }
  }
  const lockKey = `grant:${input.gateId}:${secondBucket()}`
  const locked = withWriteLock(lockKey, () => {
    const grants = listTable<GrantRow>(GRANT_TABLE)
    grants.push({
      id: nextId(grants),
      gateId: input.gateId,
      闸门编号: gate.闸门编号,
      原班组: gate.责任班组,
      借用班组: input.borrower.crewCode,
      借用人: input.borrower.name,
      授权开始: input.startIso,
      授权到期: input.expireIso,
      授权原因: input.reason || '调班期间临时借用操作权',
      状态: '生效中',
    })
    saveTable(GRANT_TABLE, grants)
    return {
      ok: true as const,
      message: `临时授权已登记：${crewName(input.borrower.crewCode)}可在 ${new Date(input.startIso).toLocaleString('zh-CN', { hour12: false })} 至 ${new Date(input.expireIso).toLocaleString('zh-CN', { hour12: false })} 启闭 ${gate.闸门编号}，到期自动收回，期间操作记录仍归${crewName(gate.责任班组)}`,
    }
  })
  if (locked.locked) {
    return { ok: false, message: '并发写入：同一时刻已有一笔授权登记，本笔按重复处理' }
  }
  return locked.value
}

/** 提前收回授权：只有责任班组能做。 */
export function revokeGrant(grantId: number, actor: Actor): ActionResult {
  const grants = listTable<GrantRow>(GRANT_TABLE)
  const grant = grants.find((row) => row.id === grantId)
  if (!grant) {
    return { ok: false, message: `没有找到编号为 ${grantId} 的授权` }
  }
  const gate = findGate(grant.gateId)
  if (!gate) {
    return { ok: false, message: '授权对应闸门不存在' }
  }
  const access = checkAccess(gate, actor, '修改归属')
  if (!access.ok) {
    return { ok: false, message: access.message }
  }
  if (grant.状态 !== '生效中') {
    return { ok: false, message: `授权已处于「${grant.状态}」，无需收回` }
  }
  grant.状态 = '已收回'
  saveTable(GRANT_TABLE, grants)
  return { ok: true, message: `闸门 ${grant.闸门编号} 对${crewName(grant.借用班组)}的临时授权已提前收回` }
}

export function recentSyncLogs(limit = 10): SyncLogRow[] {
  return listTable<SyncLogRow>('syncLogs')
    .sort((a, b) => b.处理时间.localeCompare(a.处理时间))
    .slice(0, limit)
}
