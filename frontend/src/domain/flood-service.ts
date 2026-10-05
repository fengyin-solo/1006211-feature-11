import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'
import { nowText } from './time'
import { openHoleCountByGroup, syncFloodFromGates } from './gate-service'

// 泄洪操作服务：审批与启闭同样归属到闸组责任班组；开启孔数永远与闸门页同口径。

const TARGET: Record<string, string> = {
  提交审批: '已批准',
  开启泄洪: '泄洪中',
  结束泄洪: '已结束',
}

export function listFlood(): EntryRow[] {
  // 任何读取都先按闸门口径对齐一次当前票，杜绝「闸门开着、泄洪还算关闭」。
  syncFloodFromGates()
  return listRows('flood')
}

export function openHolesSnapshot(): Record<string, number> {
  return openHoleCountByGroup()
}

export function operateFlood(input: {
  id: number
  action: string
  operator: string
  crew: string
}): ActionResult {
  const target = TARGET[input.action]
  if (!target) {
    return { ok: false, code: 'VALIDATION', message: `泄洪操作没有登记「${input.action}」这个动作` }
  }
  const rows = listRows('flood')
  const index = rows.findIndex((row) => Number(row.id) === input.id)
  if (index < 0) {
    return { ok: false, code: 'VALIDATION', message: '没有找到该泄洪操作票' }
  }
  const row = rows[index]
  const owner = String(row.责任班组 ?? '')
  if (input.crew !== owner) {
    return {
      ok: false,
      code: 'OWNERSHIP',
      message: `归属冲突：${row.泄洪闸号}泄洪操作归属${owner}，${input.crew}只能查看，${input.action}已挡回`,
    }
  }
  const holes = openHoleCountByGroup()[String(row.泄洪闸号)] ?? 0
  if (input.action === '开启泄洪' && holes <= 0) {
    return { ok: false, code: 'VALIDATION', message: '该闸组当前没有开启的闸门（开启孔数 0），请先由责任班组开启闸门再开启泄洪' }
  }
  if (input.action === '结束泄洪' && holes > 0) {
    return { ok: false, code: 'VALIDATION', message: `该闸组仍有 ${holes} 孔闸门开着，必须先全部关闭才能结束泄洪` }
  }
  const atText = nowText()
  const updated: EntryRow = {
    ...row,
    status: target,
    操作状态: target,
    pending: target !== '已结束',
    操作人员: input.operator,
    操作时间: atText,
    开启孔数: input.action === '结束泄洪' ? 0 : holes,
    _updatedAt: atText,
  }
  const next = rows.slice()
  next[index] = updated
  saveRows('flood', next)
  return { ok: true, message: `${row.操作编号}已${input.action}，当前开启孔数 ${input.action === '结束泄洪' ? 0 : holes}（与闸门页一致）` }
}
