import { listRows, listTable, nextId, resetDomain, resetRows, saveRows, saveTable } from '@/data/local-store'
import { businessDate, firstBusinessDayOfMonth, nowIso, opTimeIso } from '@/data/clock'
import { crewName } from './identity'
import { alignBayPhysical } from './gate-service'
import { reconcile } from './reconcile'
import type {
  FloodRow,
  GateLogRow,
  GateRow,
  MissingFieldRow,
  TrashrackRow,
} from './types'

// 历史数据治理（首次加载新代码时跑一次，幂等）：
// 1) 老台账字段补数，缺失字段逐条登记到缺项清单；
// 2) 闸门历史操作记录按操作时间回填，早期没有操作人的，按该闸门的责任班组补记；
// 3) 存量两套取值（闸门实测 vs 泄洪/清污登记）按「较晚一套为准」统一。

const BOOT_FLAG = 'hydropower-plant-om:bootstrapped-v2'

const MISSING_TABLE = 'missingFields'
const LOG_TABLE = 'gateLogs'

function missingRows(): MissingFieldRow[] {
  return listTable<MissingFieldRow>(MISSING_TABLE)
}

function addMissing(
  rows: MissingFieldRow[],
  source: string,
  code: string,
  field: string,
  method: string,
  filled: string,
  date: string,
): void {
  // 同一来源、同一字段只登记一次，重复执行回填不刷屏。
  if (rows.some((row) => row.来源模块 === source && row.来源编号 === code && row.缺失字段 === field)) {
    return
  }
  rows.push({
    id: nextId(rows),
    来源模块: source,
    来源编号: code,
    缺失字段: field,
    补数办法: method,
    补入值: filled,
    业务日期: date,
    登记时间: nowIso(),
  })
}

/** 历史操作人缺项的补记口径（由实现决定，固定下来）：记为「责任班组 + 值守人员（历史补记）」。 */
export function historicalOperator(ownerCrew: string): string {
  return `${crewName(ownerCrew)}值守人员（历史补记）`
}

type BackfillReport = {
  gateLogsAdded: number
  missingAdded: number
  reconciled: string[]
}

function backfillGates(missing: MissingFieldRow[]): { added: number } {
  const gates = listRows('gate') as unknown as GateRow[]
  const logs = listTable<GateLogRow>(LOG_TABLE)
  let added = 0

  for (const gate of gates) {
    const fallbackDate = firstBusinessDayOfMonth(new Date('2026-09-15T00:00:00'))
    const opDate = String(gate.操作时间 ?? '').trim()

    // 缺项：操作时间 —— 历史数据按业务日期补数，取当月首个业务日。
    if (!opDate) {
      gate.操作时间 = `${fallbackDate} 08:00:00`
      addMissing(
        missing,
        '闸门启闭',
        gate.闸门编号,
        '操作时间',
        '历史记录无操作时间，按当月首个业务日补数',
        gate.操作时间,
        fallbackDate,
      )
    }

    // 缺项：孔口尺寸 —— 无法推算的台账参数不臆造，标「待补录」挂清单，由责任班组后续登记。
    if (!String(gate.孔口尺寸 ?? '').trim()) {
      gate.孔口尺寸 = '待补录'
      addMissing(
        missing,
        '闸门启闭',
        gate.闸门编号,
        '孔口尺寸',
        '设备参数无法按历史推断，先挂「待补录」，由责任班组现场核实后补登记',
        '待补录',
        businessDate(new Date(String(gate.操作时间).replace(' ', 'T'))),
      )
    }

    // 数值字段兜底：当前开度非数字按 0 处理。
    if (typeof gate.当前开度 !== 'number' || Number.isNaN(gate.当前开度)) {
      gate.当前开度 = 0
    }

    // 历史操作记录按操作时间回填；已经回填过的闸门不重复生成。
    const backfilled = logs.some((log) => log.gateId === gate.id && log.来源.startsWith('历史回填'))
    if (!backfilled) {
      const operator = String(gate.操作人员 ?? '').trim()
      let finalOperator = operator
      if (!operator) {
        // 早期没有操作人：按该闸门的责任班组补记。
        finalOperator = historicalOperator(gate.责任班组)
        gate.操作人员 = finalOperator
        addMissing(
          missing,
          '闸门启闭',
          gate.闸门编号,
          '操作人员',
          '早期记录无操作人，按该闸门责任班组补记',
          finalOperator,
          businessDate(new Date(String(gate.操作时间).replace(' ', 'T'))),
        )
      }
      const isOpen = gate.当前开度 > 0 || gate.闸门状态 === '运行中'
      logs.push({
        id: nextId(logs),
        gateId: gate.id,
        闸门编号: gate.闸门编号,
        操作类型: isOpen ? '开启闸门' : '关闭闸门',
        操作开度: gate.当前开度,
        操作时间: gate.操作时间,
        时间戳Iso: opTimeIso(String(gate.操作时间)),
        实际操作人: finalOperator,
        归属班组: gate.责任班组,
        操作班组: gate.责任班组,
        授权依据: '历史操作记录按操作时间回填',
        结果: gate.闸门状态,
        业务日期: String(gate.操作时间).slice(0, 10),
        来源: `历史回填（按${crewName(gate.责任班组)}归属补记）`,
      })
      added += 1

      // 故障闸门再补一条故障登记记录。
      if (gate.闸门状态 === '故障' || gate.status === '故障') {
        logs.push({
          id: nextId(logs),
          gateId: gate.id,
          闸门编号: gate.闸门编号,
          操作类型: '登记故障',
          操作开度: gate.当前开度,
          操作时间: gate.操作时间,
          时间戳Iso: opTimeIso(String(gate.操作时间)),
          实际操作人: finalOperator,
          归属班组: gate.责任班组,
          操作班组: gate.责任班组,
          授权依据: '历史操作记录按操作时间回填',
          结果: '故障',
          业务日期: String(gate.操作时间).slice(0, 10),
          来源: `历史回填（按${crewName(gate.责任班组)}归属补记）`,
        })
      }
    }
  }

  saveRows('gate', gates as unknown as ReturnType<typeof listRows>[number][])
  saveTable(LOG_TABLE, logs.sort((a, b) => a.操作时间.localeCompare(b.操作时间)))
  return { added }
}

function backfillTrashrack(missing: MissingFieldRow[]): void {
  const rows = listRows('trashrack') as unknown as TrashrackRow[]
  for (const row of rows) {
    const date = String(row.清理日期 ?? '').trim()
    if (!date) {
      // 未清理的栅体没有清理日期：不算事故缺项，按「未清理」空值保留并登记说明。
      row.清理日期 = '未清理'
      addMissing(
        missing,
        '拦污栅',
        row.栅体编号,
        '清理日期',
        '该栅体尚未清理，无清理日期，按「未清理」空值保留，不伪造历史日期',
        '未清理',
        businessDate(),
      )
    }
    if (typeof row.清污次数 !== 'number' || Number.isNaN(row.清污次数)) {
      row.清污次数 = 0
      addMissing(
        missing,
        '拦污栅',
        row.栅体编号,
        '清污次数',
        '历史清污次数缺失，按 0 补数，后续清污据实累计',
        '0',
        businessDate(),
      )
    }
  }
  saveRows('trashrack', rows as unknown as ReturnType<typeof listRows>[number][])
}

/** 把闸段实际孔数与泄洪登记孔数对齐：晚的一套为准，早的一侧物理改写。 */
function reconcileBayHoles(bay: string, report: BackfillReport): void {
  const gates = listRows('gate') as unknown as GateRow[]
  const floods = listRows('flood') as unknown as FloodRow[]
  const bayGates = gates.filter((gate) => gate.参与泄洪 && gate.闸段 === bay)
  const flood = floods.find((row) => row.泄洪闸号 === bay)
  if (!flood) {
    return
  }

  // 实测取值的产生时间：有开启闸孔时只取开启闸孔最近开度时间；全关时取最近关闭时间。
  const physicalOpen = bayGates.filter((gate) => gate.当前开度 > 0).length
  const openedTimes = bayGates
    .filter((gate) => gate.当前开度 > 0)
    .map((gate) => gate.开度更新时间 ?? opTimeIso(String(gate.操作时间)))
    .sort()
  const allTimes = bayGates
    .map((gate) => gate.开度更新时间 ?? opTimeIso(String(gate.操作时间)))
    .sort()
  const latestGateTime = (openedTimes.length ? openedTimes : allTimes).at(-1) as string

  const outcome = reconcile(
    `hole:${bay}`,
    `${bay} 开启孔数`,
    '闸门实测',
    '泄洪登记',
    '孔',
    { value: physicalOpen, time: latestGateTime },
    { value: flood.开启孔数, time: flood.孔数更新时间 },
    (winner, value) => {
      if (winner === 'A') {
        // 闸门实测更晚：以闸孔实际状态为准，改泄洪页的登记孔数。
        flood.开启孔数 = value
        flood.孔数来源 = '取值对齐（闸门实测较晚）'
        flood.孔数更新时间 = nowIso()
      } else {
        // 泄洪登记更晚：以调度口径为准，逐孔开启/关闭闸门把物理状态补齐，不凭空改开度数字。
        alignBayPhysical(bay, value)
      }
    },
  )

  saveRows('flood', floods as unknown as ReturnType<typeof listRows>[number][])
  if (outcome.changed) {
    report.reconciled.push(outcome.detail)
  }
}

function reconcileCleaning(report: BackfillReport): void {
  const racks = listRows('trashrack') as unknown as TrashrackRow[]
  const ledgerTotal = racks.reduce((sum, row) => sum + (Number(row.清污次数) || 0), 0)
  const latestRackDate = racks
    .map((row) => {
      const d = String(row.清理日期 ?? '')
      return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00.000Z` : '1970-01-01T00:00:00.000Z'
    })
    .sort()
    .at(-1) as string

  const outcome = reconcile(
    'cleaning:total',
    '拦污栅 累计清污条数',
    '闸门页清污登记',
    '拦污栅台账合计',
    '条',
    // 闸门页这套取值历史上由清污登记侧维护，播种数据里登记 20 条。
    { value: 20, time: '2026-09-29T08:00:00.000Z' },
    { value: ledgerTotal, time: latestRackDate },
    (winner, value) => {
      if (winner === 'A') {
        // 闸门页登记更晚：把差额按最近清理日期补到最近一条台账上，跨页清污条数相同。
        const diff = value - ledgerTotal
        const dated = racks
          .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row.清理日期)))
          .sort((a, b) => String(b.清理日期).localeCompare(String(a.清理日期)))
        const target = dated[0]
        if (target && diff > 0) {
          target.清污次数 = Number(target.清污次数 || 0) + diff
        }
      } else {
        // 台账合计更晚时闸门页取值由 twin 统一值体现，无需改物理闸门字段。
      }
    },
  )

  if (outcome.changed) {
    saveRows('trashrack', racks as unknown as ReturnType<typeof listRows>[number][])
    report.reconciled.push(outcome.detail)
  }
}

export function bootstrapDomain(force = false): BackfillReport {
  const flag = typeof window !== 'undefined' && window.localStorage?.getItem(BOOT_FLAG)
  if (flag && !force) {
    return { gateLogsAdded: 0, missingAdded: 0, reconciled: [] }
  }

  const missing = missingRows()
  const beforeMissing = missing.length
  const gatesReport = backfillGates(missing)
  backfillTrashrack(missing)
  saveTable(MISSING_TABLE, missing)

  const report: BackfillReport = {
    gateLogsAdded: gatesReport.added,
    missingAdded: missing.length - beforeMissing,
    reconciled: [],
  }
  reconcileBayHoles('1号坝段', report)
  reconcileBayHoles('2号坝段', report)
  reconcileCleaning(report)

  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(BOOT_FLAG, nowIso())
  }
  return report
}

export function hasBootstrapped(): boolean {
  return Boolean(typeof window !== 'undefined' && window.localStorage?.getItem(BOOT_FLAG))
}

/** 演示数据整体重置：台账回播种态、领域库清空，再重跑一次回填对齐。 */
export function resetAllAndBootstrap(): BackfillReport {
  resetDomain()
  for (const key of ['gate', 'flood', 'trashrack']) {
    resetRows(key)
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(BOOT_FLAG)
  }
  return bootstrapDomain()
}
