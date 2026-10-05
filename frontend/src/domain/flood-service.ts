import { listRows, nextId, saveRows } from '@/data/local-store'
import { businessDate, now, nowIso, secondBucket } from '@/data/clock'
import { crewName } from './identity'
import { withWriteLock } from './lock'
import { reconcile } from './reconcile'
import { alignBayPhysical, bayPhysicalSnapshot } from './gate-service'
import type { ActionResult, Actor, FloodRow, GateRow } from './types'

// 泄洪操作：提交审批只允许闸段责任班组；登记孔数与闸门实测孔数走「较晚一套为准」对齐，
// 保证闸门页与泄洪页读到的开启孔数一致。

const FLOOD = 'flood'
const GATE = 'gate'

export function listFloods(): FloodRow[] {
  return listRows(FLOOD) as unknown as FloodRow[]
}

/** 闸段责任班组：该闸段参与泄洪的闸门归谁，审批就归谁。 */
export function bayOwner(bay: string): string | undefined {
  const gates = listRows(GATE) as unknown as GateRow[]
  return gates.find((gate) => gate.参与泄洪 && gate.闸段 === bay)?.责任班组
}

/** 提交审批：只允许该闸段的责任班组。 */
export function submitFloodApproval(id: number, actor: Actor): ActionResult {
  const floods = listFloods()
  const flood = floods.find((row) => row.id === id)
  if (!flood) {
    return { ok: false, message: `没有找到编号为 ${id} 的泄洪操作` }
  }
  const owner = bayOwner(flood.泄洪闸号)
  if (!owner) {
    return { ok: false, message: `闸段「${flood.泄洪闸号}」没有登记责任闸门，无法确定责任班组` }
  }
  if (actor.crewCode !== owner) {
    return {
      ok: false,
      message: `归属冲突：闸段「${flood.泄洪闸号}」的泄洪审批归${crewName(owner)}（责任班组），${actor.name} 属${crewName(actor.crewCode)}，提交审批越权，已拒绝。`,
    }
  }
  if (flood.操作状态 !== '待审批') {
    return { ok: false, message: `操作 ${flood.操作编号} 当前为「${flood.操作状态}」，不能重复提交审批` }
  }
  const lockKey = `flood:${id}:提交审批:${secondBucket()}`
  const locked = withWriteLock(lockKey, () => {
    flood.操作状态 = '已批准'
    flood.status = '已批准'
    flood.操作人员 = actor.name
    flood.操作时间 = now().toLocaleString('zh-CN', { hour12: false })
    saveRows(FLOOD, floods as unknown as ReturnType<typeof listRows>[number][])
    return { ok: true as const, message: `泄洪操作 ${flood.操作编号} 已由${crewName(owner)}提交审批并批准` }
  })
  return locked.locked
    ? { ok: false, message: '并发写入：同一时刻审批只保留一笔，本笔按重复处理' }
    : locked.value
}

/** 开启泄洪：责任班组登记本次开启孔数（这套取值带当前时间，晚则覆盖闸门实测口径）。 */
export function startFlood(id: number, actor: Actor, holes: number): ActionResult {
  const floods = listFloods()
  const flood = floods.find((row) => row.id === id)
  if (!flood) {
    return { ok: false, message: `没有找到编号为 ${id} 的泄洪操作` }
  }
  const owner = bayOwner(flood.泄洪闸号)
  if (!owner || actor.crewCode !== owner) {
    return {
      ok: false,
      message: `归属冲突：闸段「${flood.泄洪闸号}」的泄洪操作归${owner ? crewName(owner) : '未登记班组'}，${actor.name} 属${crewName(actor.crewCode)}，开启泄洪越权，已拒绝。`,
    }
  }
  const gates = listRows(GATE) as unknown as GateRow[]
  const bayGates = gates.filter((gate) => gate.参与泄洪 && gate.闸段 === flood.泄洪闸号)
  const target = Math.max(0, Math.min(Math.round(holes), bayGates.length))
  const stamp = nowIso()

  const lockKey = `flood:${id}:开启泄洪:${secondBucket()}`
  const locked = withWriteLock(lockKey, () => {
    const snapshot = bayPhysicalSnapshot(flood.泄洪闸号)
    const physicalOpen = snapshot.open

    reconcile(
      `hole:${flood.泄洪闸号}`,
      `${flood.泄洪闸号} 开启孔数`,
      '闸门实测',
      '泄洪登记',
      '孔',
      { value: physicalOpen, time: snapshot.time },
      { value: target, time: stamp },
      (winner, value) => {
        if (winner === 'B') {
          // 登记更晚：以本次调度登记为准，逐孔启闭把物理闸孔对齐，两页孔数相同。
          alignBayPhysical(flood.泄洪闸号, value)
        }
        // 闸门实测更晚时统一值保留在 twin 中，随后用闸孔实际数回写泄洪行。
      },
    )

    // 统一后以闸孔实测口径回写泄洪行（与闸门页一致）。
    const canonical = bayPhysicalSnapshot(flood.泄洪闸号).open
    flood.开启孔数 = canonical
    flood.孔数来源 = '泄洪登记对齐闸孔实测'
    flood.孔数更新时间 = stamp
    flood.操作状态 = '泄洪中'
    flood.status = '泄洪中'
    flood.操作人员 = actor.name
    flood.操作时间 = now().toLocaleString('zh-CN', { hour12: false })
    flood.业务日期 = businessDate()

    saveRows(FLOOD, floods as unknown as ReturnType<typeof listRows>[number][])
    return {
      ok: true as const,
      message: `泄洪操作 ${flood.操作编号} 已开启，登记 ${target} 孔；与闸孔实测对齐后统一为 ${canonical} 孔，闸门页与泄洪页孔数一致`,
    }
  })
  return locked.locked
    ? { ok: false, message: '并发写入：同一时刻泄洪开启只保留一笔，本笔按重复处理' }
    : locked.value
}

/** 结束泄洪：责任班组操作，两页孔数同时归零。 */
export function finishFlood(id: number, actor: Actor): ActionResult {
  const floods = listFloods()
  const flood = floods.find((row) => row.id === id)
  if (!flood) {
    return { ok: false, message: `没有找到编号为 ${id} 的泄洪操作` }
  }
  const owner = bayOwner(flood.泄洪闸号)
  if (!owner || actor.crewCode !== owner) {
    return {
      ok: false,
      message: `归属冲突：闸段「${flood.泄洪闸号}」归${owner ? crewName(owner) : '未登记班组'}，${actor.name} 越权结束泄洪，已拒绝。`,
    }
  }
  const lockKey = `flood:${id}:结束泄洪:${secondBucket()}`
  const locked = withWriteLock(lockKey, () => {
    // 责任班组逐孔关闭闸段内仍开启的闸门（由共享对齐函数落库）。
    alignBayPhysical(flood.泄洪闸号, 0)
    const stamp = nowIso()
    flood.开启孔数 = 0
    flood.孔数来源 = '泄洪结束归零'
    flood.孔数更新时间 = stamp
    flood.操作状态 = '已结束'
    flood.status = '已结束'
    flood.操作人员 = actor.name
    flood.操作时间 = now().toLocaleString('zh-CN', { hour12: false })
    reconcile(
      `hole:${flood.泄洪闸号}`,
      `${flood.泄洪闸号} 开启孔数`,
      '闸门实测',
      '泄洪登记',
      '孔',
      { value: 0, time: stamp },
      { value: 0, time: stamp },
      () => {},
    )
    saveRows(FLOOD, floods as unknown as ReturnType<typeof listRows>[number][])
    return { ok: true as const, message: `泄洪操作 ${flood.操作编号} 已结束，${flood.泄洪闸号}两页开启孔数均归零` }
  })
  return locked.locked
    ? { ok: false, message: '并发写入：同一时刻结束泄洪只保留一笔，本笔按重复处理' }
    : locked.value
}

/** 补登记一条泄洪操作（责任班组用），登记后不自动开启，仍需走审批/开启。 */
export function registerFlood(actor: Actor, bay: string, holes: number, flow: number): ActionResult {
  const owner = bayOwner(bay)
  if (!owner || actor.crewCode !== owner) {
    return {
      ok: false,
      message: `归属冲突：闸段「${bay}」归${owner ? crewName(owner) : '未登记班组'}，${actor.name} 越权登记泄洪操作，已拒绝。`,
    }
  }
  const floods = listFloods()
  const id = nextId(floods)
  floods.push({
    id,
    操作编号: `FLOO-${String(id).padStart(4, '0')}`,
    泄洪闸号: bay,
    开启孔数: Math.max(0, Math.round(holes)),
    泄洪流量: Math.max(0, Math.round(flow)),
    下游预警: '无',
    操作时间: now().toLocaleString('zh-CN', { hour12: false }),
    操作人员: actor.name,
    操作状态: '待审批',
    孔数更新时间: nowIso(),
    孔数来源: '泄洪登记',
    status: '待审批',
    pending: true,
    abnormal: false,
  })
  saveRows(FLOOD, floods as unknown as ReturnType<typeof listRows>[number][])
  return { ok: true, message: `已登记泄洪操作 FLOO-${String(id).padStart(4, '0')}（${bay}，申报 ${holes} 孔），待责任班组提交审批` }
}
