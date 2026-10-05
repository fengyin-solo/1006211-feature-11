import { listTable, nextId, saveTable } from '@/data/local-store'
import { businessDate, nowIso } from '@/data/clock'
import type { SyncLogRow, TwinRow } from './types'

// 跨页双份取值对齐：闸门页与泄洪页的「开启孔数」、闸门页与拦污栅页的「清污条数」
// 各算一套取值。两套并存且不一致时，以产生时间较晚的一套为准，并把较早的一侧统一过来。

const TWIN_TABLE = 'twins'
const LOG_TABLE = 'syncLogs'

export type TwinSide = {
  value: number
  time: string
}

export type ReconcileOutcome = {
  twin: TwinRow
  winner: 'A' | 'B' | 'equal'
  changed: boolean
  detail: string
}

export function listTwins(): TwinRow[] {
  return listTable<TwinRow>(TWIN_TABLE)
}

export function getTwin(twinKey: string): TwinRow | undefined {
  return listTwins().find((row) => row.twinKey === twinKey)
}

export function saveTwin(row: TwinRow): void {
  const rows = listTwins()
  const index = rows.findIndex((item) => item.twinKey === row.twinKey)
  if (index >= 0) {
    rows[index] = row
  } else {
    rows.push(row)
  }
  saveTable(TWIN_TABLE, rows)
}

export function listSyncLogs(): SyncLogRow[] {
  return listTable<SyncLogRow>(LOG_TABLE)
}

function appendSyncLog(log: Omit<SyncLogRow, 'id'>): void {
  const rows = listSyncLogs()
  rows.push({ id: nextId(rows), ...log })
  saveTable(LOG_TABLE, rows)
}

/**
 * 对齐一次双份取值。
 * - 先把两侧最新取值写进 twin；
 * - 取值不一致时比较产生时间：较晚的一套胜出，较早的一侧由 onUnify 回调统一改写；
 * - 产生时间也相同（同一时刻）视为并发，保留先入库的一笔，另一侧按重复处理。
 */
export function reconcile(
  twinKey: string,
  label: string,
  sideAName: string,
  sideBName: string,
  unit: string,
  sideA: TwinSide,
  sideB: TwinSide,
  onUnify: (winner: 'A' | 'B', value: number) => void,
): ReconcileOutcome {
  const existing = getTwin(twinKey)
  const twin: TwinRow =
    existing ??
    ({
      id: Date.now(),
      twinKey,
      label,
      sideAName,
      sideBName,
      sideAValue: sideA.value,
      sideATime: sideA.time,
      sideBValue: sideB.value,
      sideBTime: sideB.time,
      统一值: sideA.value,
      统一来源: sideAName,
      统一时间: sideA.time,
      unit,
    } as TwinRow)

  twin.sideAName = sideAName
  twin.sideBName = sideBName
  twin.sideAValue = sideA.value
  twin.sideATime = sideA.time
  twin.sideBValue = sideB.value
  twin.sideBTime = sideB.time

  let winner: 'A' | 'B' | 'equal'
  let changed = false
  let detail = ''

  if (sideA.value === sideB.value) {
    winner = 'equal'
    twin.统一值 = sideA.value
    // 值一致时也以产生时间较晚的一侧作为统一来源，避免较早的登记"压住"较晚的实测。
    const aLater = sideA.time >= sideB.time
    twin.统一来源 = aLater ? sideAName : sideBName
    twin.统一时间 = aLater ? sideA.time : sideB.time
    detail = `${label}两侧一致：${sideA.value}${unit}（口径取较晚产生的「${twin.统一来源}」）`
  } else {
    const ta = new Date(sideA.time).getTime()
    const tb = new Date(sideB.time).getTime()
    if (ta === tb) {
      // 同一时刻并发产生：保留先入库的一套，另一侧按重复处理，不做物理统一。
      winner = twin.统一来源 === sideBName ? 'B' : 'A'
      detail = `${label}两套取值于同一时刻产生（${sideA.time}），按并发重复处理，保留先入库的「${twin.统一来源}」${twin.统一值}${unit}`
    } else {
      winner = ta > tb ? 'A' : 'B'
      const winSide = winner === 'A' ? sideA : sideB
      const winName = winner === 'A' ? sideAName : sideBName
      const loseName = winner === 'A' ? sideBName : sideAName
      const loseValue = winner === 'A' ? sideB.value : sideA.value
      twin.统一值 = winSide.value
      twin.统一来源 = winName
      twin.统一时间 = winSide.time
      onUnify(winner, winSide.value)
      changed = true
      detail = `${label}两套取值并存：${sideAName} ${sideA.value}${unit}（${sideA.time}）、${sideBName} ${sideB.value}${unit}（${sideB.time}）；以较晚产生的「${winName}」${winSide.value}${unit}为准，已把${loseName}统一为该值`
      appendSyncLog({
        业务: label,
        twinKey,
        对齐结果: detail,
        保留值: winSide.value,
        落选值: loseValue,
        依据: `两套取值并存，以较晚产生的一套为准（${winName} ${winSide.time} 晚于 ${loseName} ${winner === 'A' ? sideB.time : sideA.time}）`,
        处理时间: nowIso(),
        业务日期: businessDate(),
      })
    }
  }

  saveTwin(twin)
  return { twin, winner, changed, detail }
}
