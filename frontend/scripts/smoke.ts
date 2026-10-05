/**
 * 领域规则冒烟测试（node 脚本，不入前端包）：
 *   npx esbuild scripts/smoke.ts --bundle --platform=node --format=cjs | node
 * 用内存版 localStorage 驱动数据层，逐条核对：越权拒绝/授权放行/重复并发/历史回填/较晚对齐/清污同步。
 */

// ---- 内存 localStorage ----
const mem = new Map<string, string>()
;(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  },
}

// 固定时钟，便于断言时间窗口
let mockNow = new Date('2026-10-05T03:00:00.000Z')
import { setClock } from '../src/data/clock'
setClock(() => mockNow)

import { bootstrapDomain, resetAllAndBootstrap } from '../src/domain/bootstrap'
import { ACTORS } from '../src/domain/identity'
import {
  createGrant,
  listGateLogs,
  operateGate,
  reassignGate,
  reportGateFault,
} from '../src/domain/gate-service'
import { finishFlood, startFlood, submitFloodApproval } from '../src/domain/flood-service'
import { completeCleaning, canonicalCleaningTotal, registerCleaningFromGate } from '../src/domain/trashrack-service'
import { listRows, listTable } from '../src/data/local-store'
import type { FloodRow, GateRow, GrantRow, MissingFieldRow, TwinRow } from '../src/domain/types'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name} ${detail}`)
  }
}

const runA = ACTORS[0]
const runB = ACTORS[1]
const maint = ACTORS[2]
const watch = ACTORS[3]

// ============ 1. 历史回填与缺项 ============
console.log('# 历史回填')
const report = bootstrapDomain()
const gates = listRows('gate') as unknown as GateRow[]
const floods = listRows('flood') as unknown as FloodRow[]
const logs = listGateLogs()
const missing = listTable<MissingFieldRow>('missingFields')

check('为 7 扇闸门回填了历史操作记录', logs.length >= 7, `实际 ${logs.length}`)
check('无操作人的 GATE-0001 按责任班组补记', gates[0].操作人员.includes('运行甲班值守人员'), gates[0].操作人员)
check('缺操作时间的 GATE-0003 按当月首个业务日补数', gates[2].操作时间 === '2026-09-01 08:00:00', gates[2].操作时间)
check('孔口尺寸缺失挂「待补录」并入缺项清单', gates[5].孔口尺寸 === '待补录')
check('缺项清单非空', missing.length >= 4, `实际 ${missing.length}`)
check('历史记录归属班组即责任班组', logs.every((log) => log.归属班组.length > 0))
check('回填报告统计与清单一致', report.missingAdded === missing.length, `${report.missingAdded} vs ${missing.length}`)

// ============ 2. 存量取值对齐（较晚一套为准） ============
console.log('# 存量取值对齐')
const twins = listTable<TwinRow>('twins')
const bay1 = twins.find((t) => t.twinKey === 'hole:1号坝段')
const bay2 = twins.find((t) => t.twinKey === 'hole:2号坝段')
const cleaning = twins.find((t) => t.twinKey === 'cleaning:total')

check('1号坝段两侧一致，统一来源取较晚的泄洪登记', bay1?.统一值 === 1 && bay1?.统一来源 === '泄洪登记')
check('2号坝段以较晚的泄洪登记 3 孔统一', bay2?.统一值 === 3)
check('2号坝段对齐后物理闸孔开启 3 扇', gates.filter((g) => g.闸段 === '2号坝段' && g.当前开度 > 0).length === 3)
check('泄洪页 2号坝段孔数与闸门实测一致(3)', floods.find((f) => f.泄洪闸号 === '2号坝段')?.开启孔数 === 3)
check('清污条数以较晚的闸门页登记 20 统一', cleaning?.统一值 === 20)
check('拦污栅台账合计被统一到 20', listRows('trashrack').reduce((s, r) => s + Number((r as TrashrackLike).清污次数 || 0), 0) === 20)
type TrashrackLike = { 清污次数: number }

// ============ 3. 归属与越权 ============
console.log('# 归属与越权')
const gate1 = gates.find((g) => g.闸门编号 === 'GATE-0001')!
const deniedByB = operateGate({ gateId: gate1.id, action: '开启闸门', actor: runB, opening: 2 })
check('乙班开甲班闸门被拒绝', !deniedByB.ok && deniedByB.message.includes('归属冲突'))
const deniedByWatch = operateGate({ gateId: gate1.id, action: '开启闸门', actor: watch, opening: 2 })
check('观测岗任何操作被拒', !deniedByWatch.ok && deniedByWatch.message.includes('只读'))
const deniedFault = reportGateFault(gate1.id, runB)
check('故障登记只认责任班组（借用也不行）', !deniedFault.ok && deniedFault.message.includes('登记故障'))
const deniedReassign = reassignGate(gate1.id, runB, { 责任班组: 'RUN-B' })
check('改归属越权被拒', !deniedReassign.ok)
const okA = operateGate({ gateId: gate1.id, action: '开启闸门', actor: runA, opening: 3 })
check('甲班开自己闸门成功', okA.ok, okA.message)
check('开启后泄洪页孔数同步为 2', floods.find((f) => f.泄洪闸号 === '1号坝段')!.id > 0)
{
  const refreshedFloods = listRows('flood') as unknown as FloodRow[]
  check('1号坝段泄洪登记孔数同步为 2 孔', refreshedFloods.find((f) => f.泄洪闸号 === '1号坝段')?.开启孔数 === 2)
}

// ============ 4. 重复操作与并发 ============
console.log('# 重复与并发')
const dup = operateGate({ gateId: gate1.id, action: '开启闸门', actor: runA, opening: 4 })
check('已开启闸门重复开启被拒', !dup.ok && dup.message.includes('重复'))
const close1 = operateGate({ gateId: gate1.id, action: '关闭闸门', actor: runA })
check('首次关闭成功', close1.ok, close1.message)
const close2 = operateGate({ gateId: gate1.id, action: '关闭闸门', actor: runA })
check('同一时段第二次关闭按重复拒绝', !close2.ok && close2.message.includes('重复'))
const concurrent = await Promise.allSettled([
  Promise.resolve(operateGate({ gateId: gates[1].id, action: '关闭闸门', actor: runA })),
  Promise.resolve(operateGate({ gateId: gates[1].id, action: '关闭闸门', actor: runA })),
])
const cResults = concurrent.map((p) => (p.status === 'fulfilled' ? p.value : null))
check('同一时刻并发写入只保留一笔', cResults.filter((r) => r?.ok).length === 1)

// ============ 5. 临时授权 ============
console.log('# 临时授权')
// GATE-0003 属甲班；播种里对乙班的授权已过期 → 自动收回
const grants = listTable<GrantRow>('grants')
check('过期授权被自动置为已到期', grants.find((g) => g.id === 2)?.状态 === '已到期')
const expiredBorrow = operateGate({ gateId: 3, action: '开启闸门', actor: runB, opening: 1 })
check('授权到期后借用班组被挡回', !expiredBorrow.ok && expiredBorrow.message.includes('归属冲突'))

const future = new Date(mockNow.getTime() + 3600 * 1000).toISOString()
const grant = createGrant(runA, {
  gateId: 3,
  borrower: runB,
  reason: '调班测试',
  startIso: mockNow.toISOString(),
  expireIso: future,
})
check('责任班组可发放临时授权', grant.ok, grant.message)
const borrowOk = operateGate({ gateId: 3, action: '开启闸门', actor: runB, opening: 2 })
check('借用班组授权期内可开启', borrowOk.ok, borrowOk.message)
const borrowLog = listGateLogs().find((l) => l.gateId === 3 && l.操作类型 === '开启闸门' && l.结果 === '运行中')
check('授权期间操作记录仍归原班组(甲班)', borrowLog?.归属班组 === 'RUN-A' && borrowLog?.操作班组 === 'RUN-B')
const borrowFault = reportGateFault(3, runB)
check('借用人不能登记故障', !borrowFault.ok)
// 快进到授权到期后
mockNow = new Date(future).getTime() ? new Date(future) : mockNow
const afterExpire = operateGate({ gateId: 3, action: '关闭闸门', actor: runB })
check('到期后操作权自动收回', !afterExpire.ok)

// ============ 6. 泄洪审批归属与孔数对齐 ============
console.log('# 泄洪审批与孔数对齐')
const flood2 = (listRows('flood') as unknown as FloodRow[]).find((f) => f.操作编号 === 'FLOO-0002')!
const wrongApproval = submitFloodApproval(flood2.id, runA)
check('非闸段责任班组提交审批被拒', !wrongApproval.ok && wrongApproval.message.includes('归属冲突'))
const rightApproval = submitFloodApproval(flood2.id, runB)
check('责任班组提交审批成功', rightApproval.ok, rightApproval.message)
const start = startFlood(flood2.id, runB, 3)
check('责任班组开启泄洪', start.ok, start.message)
{
  const gs = listRows('gate') as unknown as GateRow[]
  const fs = listRows('flood') as unknown as FloodRow[]
  const physical = gs.filter((g) => g.闸段 === '2号坝段' && g.当前开度 > 0).length
  check('开启泄洪后两页孔数一致', physical === fs.find((f) => f.id === flood2.id)?.开启孔数, `实测 ${physical}`)
}
const finish = finishFlood(flood2.id, runB)
check('结束泄洪两页孔数归零', finish.ok)
{
  const gs = listRows('gate') as unknown as GateRow[]
  const fs = listRows('flood') as unknown as FloodRow[]
  check('归零后两页孔数都为 0', gs.filter((g) => g.闸段 === '2号坝段' && g.当前开度 > 0).length === 0 && fs.find((f) => f.id === flood2.id)?.开启孔数 === 0)
}

// ============ 7. 清污同步 ============
console.log('# 清污条数同步')
const before = canonicalCleaningTotal()
const rack = listRows('trashrack')[0]
const cleanDenied = completeCleaning(Number(rack.id), watch, { 清污方式: 'x', 条数: 2 })
check('观测岗清污被拒', !cleanDenied.ok)
const cleanOk = completeCleaning(Number(rack.id), runA, { 清污方式: '清污机抓取', 条数: 2 })
check('责任岗位清污成功', cleanOk.ok, cleanOk.message)
check('清污后统一条数增加 2', canonicalCleaningTotal() === before + 2, `${before} -> ${canonicalCleaningTotal()}`)
const reg = registerCleaningFromGate(runB, 3)
check('闸门页登记清污同步台账', reg.ok, reg.message)
{
  const total = (listRows('trashrack') as unknown as { 清污次数: number }[]).reduce((s, r) => s + Number(r.清污次数 || 0), 0)
  check('台账合计与统一口径一致', total === canonicalCleaningTotal(), `${total} vs ${canonicalCleaningTotal()}`)
}

// ============ 8. 检修闸门归属 ============
console.log('# 检修闸门')
const gate7 = gates.find((g) => g.闸门编号 === 'GATE-0007')!
const runTouch = operateGate({ gateId: gate7.id, action: '开启闸门', actor: runA, opening: 1 })
check('运行岗不能动检修班组的检修闸门', !runTouch.ok)
const maintOk = reassignGate(gate7.id, maint, { 操作范围: '检修' })
check('检修班组能维护自己闸门的归属', maintOk.ok)

// ============ 9. 重置后可重跑 ============
console.log('# 重置幂等')
const rerun = resetAllAndBootstrap()
check('重置后重新回填', rerun.gateLogsAdded >= 7 && rerun.missingAdded >= 4)
check('再次 bootstrap 幂等', bootstrapDomain().gateLogsAdded === 0)

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) {
  process.exit(1)
}
void maintOk
