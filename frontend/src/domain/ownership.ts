import type { Actor, GateRow, GrantRow } from './types'
import { crewName } from './identity'
import { now } from '@/data/clock'
import { listTable, saveTable } from '@/data/local-store'

// 闸门归属与调班授权策略：闸门归班组，开启/关闭看「责任班组或生效中的借用班组」，
// 故障登记、提交审批、改归属只认责任班组；授权到期自动收回。

const TABLE = 'grants'

export function listGrants(): GrantRow[] {
  return listTable<GrantRow>(TABLE)
}

/** 到期的授权自动置为「已到期」，不删记录，留痕可查。 */
export function expireGrants(at: Date = now()): GrantRow[] {
  const rows = listGrants()
  let changed = false
  for (const row of rows) {
    if (row.状态 === '生效中' && new Date(row.授权到期).getTime() <= at.getTime()) {
      row.状态 = '已到期'
      changed = true
    }
  }
  if (changed) {
    saveTable(TABLE, rows)
  }
  return rows
}

/** 找到一扇闸门当前生效的借用授权；过期或已收回均视为没有。 */
export function activeGrant(gateId: number, at: Date = now()): GrantRow | undefined {
  return expireGrants(at).find(
    (row) =>
      row.gateId === gateId &&
      row.状态 === '生效中' &&
      new Date(row.授权开始).getTime() <= at.getTime() &&
      new Date(row.授权到期).getTime() > at.getTime(),
  )
}

export type AccessKind = '开启' | '关闭' | '登记故障' | '提交审批' | '修改归属' | '只读'

/**
 * 归属校验。返回允许/拒绝以及一句写清归属冲突的话术。
 * - 开启、关闭：责任班组本人，或持有生效临时授权的借用班组可以做；
 * - 登记故障、提交审批、修改归属：只允许责任班组，借用也不行；
 * - 观测岗等其他岗位：只读。
 */
export function checkAccess(
  gate: GateRow,
  actor: Actor,
  kind: Exclude<AccessKind, '只读'>,
): { ok: boolean; message: string; grant?: GrantRow } {
  const owner = gate.责任班组
  const grant = activeGrant(gate.id)
  const ownerLabel = `${crewName(owner)}（责任班组）`

  if (actor.crewCode === owner) {
    return { ok: true, message: '', grant }
  }

  // 观测岗等只读岗位：话术直接点明只读，不允许任何写操作。
  if (actor.role === '观测岗') {
    return {
      ok: false,
      message: `归属冲突：闸门 ${gate.闸门编号} 属${ownerLabel}，操作范围「${gate.操作范围}」；${actor.name} 属${crewName(actor.crewCode)}（观测岗），只有只读权限（可查看孔口尺寸与启闭机信息、归属），${kind}操作一律拒绝。`,
    }
  }

  if (grant && (kind === '开启' || kind === '关闭') && actor.crewCode === grant.借用班组) {
    return {
      ok: true,
      message: '',
      grant,
    }
  }

  // 越权：一律挡回去，话术里写清这扇闸门归谁、操作人属于谁、冲突在哪。
  const grantHint = grant
    ? `当前仅${crewName(grant.借用班组)}在${new Date(grant.授权到期).toLocaleString('zh-CN', { hour12: false })}前借有启闭权；`
    : ''
  const scopeHint =
    kind === '修改归属'
      ? '闸门归属只有责任班组能改，其他岗位只读。'
      : kind === '登记故障' || kind === '提交审批'
        ? '该操作只允许责任班组办理，临时借用人也不能代办。'
        : `${kind}操作只认责任班组（或其生效中的临时授权）。`
  return {
    ok: false,
    message: `归属冲突：闸门 ${gate.闸门编号} 属${ownerLabel}，操作范围「${gate.操作范围}」；${actor.name} 属${crewName(actor.crewCode)}，无权${kind}。${grantHint}${scopeHint}`,
  }
}
