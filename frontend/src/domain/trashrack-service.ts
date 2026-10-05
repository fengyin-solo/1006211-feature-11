import { listRows, saveRows } from '@/data/local-store'
import { businessDate, now, nowIso, secondBucket } from '@/data/clock'
import { crewName } from './identity'
import { withWriteLock } from './lock'
import { getTwin, reconcile } from './reconcile'
import type { ActionResult, Actor, TrashrackRow } from './types'

// 拦污栅清污：清污结果同步到闸门页的清污口径，跨页清污条数相同；
// 两套并存且有争议时，以较晚产生的一套为准，并把另一侧统一过来。

const TRASHRACK = 'trashrack'
const TWIN_KEY = 'cleaning:total'

export function listRacks(): TrashrackRow[] {
  return listRows(TRASHRACK) as unknown as TrashrackRow[]
}

export function ledgerCleaningTotal(): number {
  return listRacks().reduce((sum, row) => sum + (Number(row.清污次数) || 0), 0)
}

/** 跨页统一后的清污条数（闸门页与拦污栅页读的都是这个值）。 */
export function canonicalCleaningTotal(): number {
  const twin = getTwin(TWIN_KEY)
  if (twin) {
    return twin.统一值
  }
  return ledgerCleaningTotal()
}

function latestRackTime(): string {
  return (
    listRacks()
      .map((row) => {
        const d = String(row.清理日期 ?? '')
        return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00.000Z` : '1970-01-01T00:00:00.000Z'
      })
      .sort()
      .at(-1) ?? '1970-01-01T00:00:00.000Z'
  )
}

/** 确认完成一次清污：运行/检修岗可操作（观测岗只读），条数 +1 并与闸门页口径对齐。 */
export function completeCleaning(
  rackId: number,
  actor: Actor,
  payload: { 清污方式: string; 条数: number },
): ActionResult {
  if (actor.role === '观测岗') {
    return { ok: false, message: `归属冲突：${actor.name} 属${crewName(actor.crewCode)}（观测岗），拦污栅台账只读，清污操作已拒绝。` }
  }
  const racks = listRacks()
  const rack = racks.find((row) => row.id === rackId)
  if (!rack) {
    return { ok: false, message: `没有找到编号为 ${rackId} 的拦污栅` }
  }
  const add = Math.max(1, Math.round(Number(payload.条数) || 1))
  const lockKey = `trashrack:${rackId}:确认完成:${secondBucket()}`
  const locked = withWriteLock(lockKey, () => {
    const stamp = nowIso()
    rack.清污次数 = Number(rack.清污次数 || 0) + add
    rack.清污方式 = payload.清污方式 || '清污机抓取'
    rack.清理日期 = businessDate()
    rack.清理人员 = actor.name
    rack.栅体状态 = '已清理'
    rack.status = '已清理'
    rack.pending = false

    // 本次清污结果同步到闸门页口径：用台账新合计 + 当前时间对齐，较晚一套为准。
    reconcile(
      TWIN_KEY,
      '拦污栅 累计清污条数',
      '闸门页清污登记',
      '拦污栅台账合计',
      '条',
      { value: getTwin(TWIN_KEY)?.sideAValue ?? ledgerCleaningTotal(), time: getTwin(TWIN_KEY)?.sideATime ?? '1970-01-01T00:00:00.000Z' },
      { value: ledgerCleaningTotal(), time: stamp },
      (winner, value) => {
        if (winner === 'A') {
          // 闸门页登记更晚：把差额补到本次清理的台账行，保证两页条数相同。
          const diff = value - ledgerCleaningTotal()
          if (diff > 0) {
            rack.清污次数 = Number(rack.清污次数) + diff
          }
        }
      },
    )

    saveRows(TRASHRACK, racks as unknown as ReturnType<typeof listRows>[number][])
    return { ok: true, message: `${rack.栅体编号} 清污完成，新增 ${add} 条；跨页统一清污条数为 ${canonicalCleaningTotal()} 条（闸门页与拦污栅页相同）` }
  })
  return locked.locked
    ? { ok: false, message: '并发写入：同一时刻清污登记只保留一笔，本笔按重复处理' }
    : locked.value
}

/** 安排清理（状态转为清理中），观测岗只读。 */
export function scheduleCleaning(rackId: number, actor: Actor): ActionResult {
  if (actor.role === '观测岗') {
    return { ok: false, message: `归属冲突：${actor.name} 属观测岗，拦污栅台账只读，安排清理已拒绝。` }
  }
  const racks = listRacks()
  const rack = racks.find((row) => row.id === rackId)
  if (!rack) {
    return { ok: false, message: `没有找到编号为 ${rackId} 的拦污栅` }
  }
  const lockKey = `trashrack:${rackId}:安排清理:${secondBucket()}`
  const locked = withWriteLock(lockKey, () => {
    rack.栅体状态 = '清理中'
    rack.status = '清理中'
    rack.pending = true
    rack.清理人员 = actor.name
    saveRows(TRASHRACK, racks as unknown as ReturnType<typeof listRows>[number][])
    return { ok: true as const, message: `${rack.栅体编号} 已安排清理` }
  })
  return locked.locked
    ? { ok: false, message: '并发写入：同一时刻安排清理只保留一笔，本笔按重复处理' }
    : locked.value
}

/** 登记损坏。 */
export function reportRackDamage(rackId: number, actor: Actor): ActionResult {
  if (actor.role === '观测岗') {
    return { ok: false, message: `归属冲突：${actor.name} 属观测岗，拦污栅台账只读，登记损坏已拒绝。` }
  }
  const racks = listRacks()
  const rack = racks.find((row) => row.id === rackId)
  if (!rack) {
    return { ok: false, message: `没有找到编号为 ${rackId} 的拦污栅` }
  }
  const lockKey = `trashrack:${rackId}:登记损坏:${secondBucket()}`
  const locked = withWriteLock(lockKey, () => {
    rack.栅体状态 = '已损坏'
    rack.status = '已损坏'
    rack.abnormal = true
    rack.清理人员 = actor.name
    saveRows(TRASHRACK, racks as unknown as ReturnType<typeof listRows>[number][])
    return { ok: true as const, message: `${rack.栅体编号} 已登记损坏` }
  })
  return locked.locked
    ? { ok: false, message: '并发写入：同一时刻损坏登记只保留一笔，本笔按重复处理' }
    : locked.value
}

/** 闸门页登记清污条数（责任班组）：写入「闸门页」这套取值并与台账对齐。 */
export function registerCleaningFromGate(actor: Actor, 条数: number): ActionResult {
  if (actor.role === '观测岗') {
    return { ok: false, message: `归属冲突：${actor.name} 属观测岗，清污登记已拒绝。` }
  }
  const add = Math.max(1, Math.round(Number(条数) || 1))
  const lockKey = `cleaning:register:${secondBucket()}`
  const locked = withWriteLock(lockKey, () => {
    const stamp = nowIso()
    const twin = getTwin(TWIN_KEY)
    const nextGateValue = (twin?.sideAValue ?? ledgerCleaningTotal()) + add
    reconcile(
      TWIN_KEY,
      '拦污栅 累计清污条数',
      '闸门页清污登记',
      '拦污栅台账合计',
      '条',
      { value: nextGateValue, time: stamp },
      { value: ledgerCleaningTotal(), time: latestRackTime() },
      (winner, value) => {
        if (winner === 'A') {
          // 闸门页登记更晚：差额落到最近一条台账，跨页条数相同。
          const racks = listRacks()
          const diff = value - racks.reduce((sum, row) => sum + (Number(row.清污次数) || 0), 0)
          const dated = racks
            .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row.清理日期)))
            .sort((a, b) => String(b.清理日期).localeCompare(String(a.清理日期)))
          const target = dated[0] ?? racks[0]
          if (target && diff > 0) {
            target.清污次数 = Number(target.清污次数 || 0) + diff
            saveRows(TRASHRACK, racks as unknown as ReturnType<typeof listRows>[number][])
          }
        }
      },
    )
    return {
      ok: true as const,
      message: `闸门页登记清污 ${add} 条，已同步到拦污栅台账，跨页统一清污条数 ${canonicalCleaningTotal()} 条`,
    }
  })
  return locked.locked
    ? { ok: false, message: '并发写入：同一时刻清污登记只保留一笔，本笔按重复处理' }
    : locked.value
}
