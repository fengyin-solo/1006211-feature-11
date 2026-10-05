import { getDomain, saveRows, saveDomain, type DomainTables } from '@/data/local-store'
import type {
  CleanLedgerEntry,
  EntryRow,
  GateAuth,
  GateLedgerEntry,
} from '@/data/types'
import { hoursAgo, formatTime } from './time'

// 操作范围：闸门自身登记的允许动作口径（页面上按中文展示）。
export const SCOPE_LABELS: Record<string, string> = {
  open: '仅开启',
  'open-close': '开启/关闭',
  all: '开启/关闭/故障登记',
}

export const SCOPE_OPTIONS = ['open', 'open-close', 'all'] as const

type GateSeed = {
  id: number
  no: string
  type: string
  size: string
  opening: number
  hoist: string
  group: string
  crew: string
  scope: string
  status: string
  operator: string
  operatedAt: string
  updatedOffsetH?: number
  sizeMissing?: boolean
}

const GATE_SEEDS: GateSeed[] = [
  { id: 1, no: 'GATE-0001', type: '表孔工作闸门', size: '12m×8m', opening: 80, hoist: 'QP-2×1600kN固定卷扬机', group: '表孔A组', crew: '运行一班', scope: 'open-close', status: '运行中', operator: '张运行', operatedAt: '' },
  { id: 2, no: 'GATE-0002', type: '表孔工作闸门', size: '12m×8m', opening: 100, hoist: 'QP-2×1600kN固定卷扬机', group: '表孔A组', crew: '运行一班', scope: 'all', status: '运行中', operator: '李开启', operatedAt: '' },
  { id: 3, no: 'GATE-0003', type: '表孔工作闸门', size: '12m×8m', opening: 0, hoist: 'QP-2×1600kN固定卷扬机', group: '表孔A组', crew: '运行一班', scope: 'all', status: '已关闭', operator: '赵检修(借权)', operatedAt: '' },
  { id: 4, no: 'GATE-0004', type: '底孔泄洪闸门', size: '4m×5m', opening: 60, hoist: 'QPG-2×1000kN高扬程卷扬机', group: '底孔B组', crew: '运行二班', scope: 'open-close', status: '运行中', operator: '王泄洪', operatedAt: '' },
  { id: 5, no: 'GATE-0005', type: '底孔泄洪闸门', size: '4m×5m', opening: 0, hoist: 'QPG-2×1000kN高扬程卷扬机', group: '底孔B组', crew: '运行二班', scope: 'open-close', status: '已关闭', operator: '陈底孔', operatedAt: '' },
  { id: 6, no: 'GATE-0006', type: '检修闸门', size: '10m×7m', opening: 0, hoist: 'QP-1×800kN移动式卷扬机', group: '—', crew: '检修班', scope: 'open', status: '待操作', sizeMissing: true, operator: '', operatedAt: '' },
]

function gateRows(base: number): EntryRow[] {
  return GATE_SEEDS.map((seed, index) => {
    const updatedAt = seed.operatedAt || formatTime(hoursAgo(base, seed.updatedOffsetH ?? index + 1))
    return {
      id: seed.id,
      status: seed.status,
      pending: seed.status === '待操作' || seed.status === '运行中',
      abnormal: seed.status === '故障',
      闸门编号: seed.no,
      闸门类型: seed.type,
      孔口尺寸: seed.sizeMissing ? '待补' : seed.size,
      当前开度: seed.opening,
      启闭机型号: seed.hoist,
      泄洪闸组: seed.group,
      责任班组: seed.crew,
      操作范围: SCOPE_LABELS[seed.scope],
      操作人员: seed.operator,
      操作时间: updatedAt,
      闸门状态: seed.status,
      _updatedAt: updatedAt,
    }
  })
}

function floodRows(): EntryRow[] {
  return [
    {
      id: 1, status: '泄洪中', pending: false, abnormal: false,
      操作编号: 'FLOO-2026-1001', 泄洪闸号: '表孔A组', 开启孔数: 2, 泄洪流量: 1860,
      下游预警: '未预警', 操作时间: '2026-10-05 09:12:00', 操作人员: '李开启',
      责任班组: '运行一班', 操作状态: '泄洪中', _updatedAt: '2026-10-05 09:12:00',
    },
    {
      id: 2, status: '已批准', pending: true, abnormal: false,
      操作编号: 'FLOO-2026-1002', 泄洪闸号: '底孔B组', 开启孔数: 0, 泄洪流量: 0,
      下游预警: '未预警', 操作时间: '2026-10-05 08:40:00', 操作人员: '王泄洪',
      责任班组: '运行二班', 操作状态: '已批准', _updatedAt: '2026-10-05 08:40:00',
    },
    // 争议快照：底孔B组最新票记成「已批准/0孔」，但 GATE-0004 当前开着（更晚的闸门操作）。
    // 按「较晚产生的取值为准」，对齐时这张最新票改成 泄洪中/1孔。
    {
      id: 3, status: '已结束', pending: false, abnormal: false,
      操作编号: 'FLOO-2026-0921', 泄洪闸号: '表孔A组', 开启孔数: 0, 泄洪流量: 0,
      下游预警: '未预警', 操作时间: '2026-09-20 17:30:00', 操作人员: '历史补记·运行一班',
      责任班组: '运行一班', 操作状态: '已结束', _updatedAt: '2026-09-20 17:30:00',
    },
  ]
}

function trashrackRows(): EntryRow[] {
  return [
    {
      id: 1, status: '已清理', pending: false, abnormal: false,
      栅体编号: 'TRAS-0001', 所属机组: '1号机', 前后压差: '0.4m', 清污次数: 1,
      清污方式: '机械清污', 清理日期: '2026-10-03', 清理人员: '周清污',
      关联闸门: 'GATE-0001', 栅体状态: '已清理', _updatedAt: '2026-10-03 10:20:00',
    },
    // 争议快照：台账记了两条清污（较晚一条 10-04），页面快照还停在 1 次。
    {
      id: 2, status: '已清理', pending: false, abnormal: false,
      栅体编号: 'TRAS-0002', 所属机组: '2号机', 前后压差: '0.5m', 清污次数: 1,
      清污方式: '人工清污', 清理日期: '2026-10-02', 清理人员: '',
      关联闸门: 'GATE-0002', 栅体状态: '已清理', _updatedAt: '2026-10-02 09:00:00',
    },
    {
      id: 3, status: '待清理', pending: true, abnormal: false,
      栅体编号: 'TRAS-0003', 所属机组: '3号机', 前后压差: '1.2m', 清污次数: 0,
      清污方式: '—', 清理日期: '', 清理人员: '',
      关联闸门: 'GATE-0004', 栅体状态: '待清理', _updatedAt: '2026-10-05 06:00:00',
    },
    {
      id: 4, status: '已清理', pending: false, abnormal: false,
      栅体编号: 'TRAS-0004', 所属机组: '4号机', 前后压差: '0.3m', 清污次数: 0,
      清污方式: '待补', 清理日期: '2026-10-04', 清理人员: '吴水清',
      关联闸门: 'GATE-0005', 栅体状态: '已清理', _updatedAt: '2026-10-04 15:00:00',
    },
  ]
}

function crewRows(): EntryRow[] {
  const people: [string, string, string, string, string, string, string][] = [
    ['CREW-0001', '张运行', '运行岗', '闸门操作证', '2027-06-30', '运行一班', '在场'],
    ['CREW-0002', '李开启', '运行岗', '闸门操作证', '2027-06-30', '运行一班', '在场'],
    ['CREW-0003', '王泄洪', '运行岗', '泄洪操作证', '2027-03-15', '运行二班', '在场'],
    ['CREW-0004', '陈底孔', '运行岗', '泄洪操作证', '2027-03-15', '运行二班', '在场'],
    ['CREW-0005', '赵检修', '检修岗', '金属结构检修证', '2026-12-31', '检修班', '在场'],
    ['CREW-0006', '孙工作', '检修岗', '工作负责人证', '2027-01-20', '检修班', '在场'],
    ['CREW-0007', '周清污', '清污岗', '清污作业证', '2027-05-10', '清污班', '在场'],
    ['CREW-0008', '吴水清', '清污岗', '清污作业证', '2027-05-10', '清污班', '在场'],
    ['CREW-0009', '郑调度', '水情岗', '调度资格证', '2027-08-01', '水情班', '在场'],
  ]
  return people.map(([no, name, post, cert, valid, crew, status], index) => ({
    id: index + 1,
    status,
    pending: status !== '在场',
    abnormal: false,
    人员编号: no,
    姓名: name,
    岗位: post,
    持证类型: cert,
    证书有效期: valid,
    所属班组: crew,
    联系电话: `138${String(10000000 + index * 111).slice(0, 8)}`,
    在场状态: status,
  }))
}

// 闸门操作台账：append-only，历史条目按业务日期回填，早期没有操作人的按责任班组补记。
function gateLedger(base: number): GateLedgerEntry[] {
  const history: GateLedgerEntry[] = [
    { id: 1, gateId: '1', gateNo: 'GATE-0001', action: '开启闸门', result: 'accepted', operator: '历史补记·运行一班', operatorCrew: '运行一班', ownerCrew: '运行一班', openingAfter: 60, statusAfter: '运行中', operatedAt: '2026-09-10 08:30:00', source: 'history-backfill', note: '早期记录无操作人，按闸门责任班组补记' },
    { id: 2, gateId: '1', gateNo: 'GATE-0001', action: '关闭闸门', result: 'accepted', operator: '历史补记·运行一班', operatorCrew: '运行一班', ownerCrew: '运行一班', openingAfter: 0, statusAfter: '已关闭', operatedAt: '2026-09-10 17:05:00', source: 'history-backfill', note: '早期记录无操作人，按闸门责任班组补记' },
    { id: 3, gateId: '4', gateNo: 'GATE-0004', action: '开启闸门', result: 'accepted', operator: '历史补记·运行二班', operatorCrew: '运行二班', ownerCrew: '运行二班', openingAfter: 50, statusAfter: '运行中', operatedAt: '2026-09-15 09:00:00', source: 'history-backfill', note: '早期记录无操作人，按闸门责任班组补记' },
    { id: 4, gateId: '4', gateNo: 'GATE-0004', action: '关闭闸门', result: 'accepted', operator: '历史补记·运行二班', operatorCrew: '运行二班', ownerCrew: '运行二班', openingAfter: 0, statusAfter: '已关闭', operatedAt: '2026-09-15 16:40:00', source: 'history-backfill', note: '早期记录无操作人，按闸门责任班组补记' },
    { id: 5, gateId: '6', gateNo: 'GATE-0006', action: '关闭闸门', result: 'accepted', operator: '历史补记·检修班', operatorCrew: '检修班', ownerCrew: '检修班', openingAfter: 0, statusAfter: '已关闭', operatedAt: '2026-09-20 11:00:00', source: 'history-backfill', note: '早期记录无操作人，按闸门责任班组补记' },
  ]
  // 近期条目按相对当前时间偏移，保证示例在任何日期打开都是「最近」发生的。
  const recent: GateLedgerEntry[] = [
    { id: 6, gateId: '1', gateNo: 'GATE-0001', action: '开启闸门', result: 'rejected', rejectCode: 'OWNERSHIP', operator: '赵检修', operatorCrew: '检修班', ownerCrew: '运行一班', openingAfter: 0, statusAfter: '待操作', operatedAt: formatTime(hoursAgo(base, 30)), note: '归属冲突：检修班越权开启运行一班闸门，已挡回' },
    { id: 7, gateId: '1', gateNo: 'GATE-0001', action: '开启闸门', result: 'accepted', operator: '张运行', operatorCrew: '运行一班', ownerCrew: '运行一班', openingAfter: 80, statusAfter: '运行中', operatedAt: formatTime(hoursAgo(base, 2)) },
    { id: 8, gateId: '2', gateNo: 'GATE-0002', action: '开启闸门', result: 'accepted', operator: '李开启', operatorCrew: '运行一班', ownerCrew: '运行一班', openingAfter: 100, statusAfter: '运行中', operatedAt: formatTime(hoursAgo(base, 3)) },
    { id: 9, gateId: '2', gateNo: 'GATE-0002', action: '开启闸门', result: 'rejected', rejectCode: 'DUP', operator: '李开启', operatorCrew: '运行一班', ownerCrew: '运行一班', openingAfter: 100, statusAfter: '运行中', operatedAt: formatTime(hoursAgo(base, 3) + 40_000), note: '同一时段重复操作，只认第一条' },
    // GATE-0003：运行一班把操作权临时借给检修班，借权期间的操作归属仍记运行一班。
    { id: 10, gateId: '3', gateNo: 'GATE-0003', action: '关闭闸门', result: 'accepted', operator: '赵检修', operatorCrew: '检修班', ownerCrew: '运行一班', openingAfter: 0, statusAfter: '已关闭', operatedAt: formatTime(hoursAgo(base, 6)), viaAuth: true, note: '调班借权操作，归属仍记运行一班' },
    { id: 11, gateId: '4', gateNo: 'GATE-0004', action: '开启闸门', result: 'accepted', operator: '王泄洪', operatorCrew: '运行二班', ownerCrew: '运行二班', openingAfter: 60, statusAfter: '运行中', operatedAt: formatTime(hoursAgo(base, 1)) },
    { id: 12, gateId: '5', gateNo: 'GATE-0005', action: '关闭闸门', result: 'accepted', operator: '陈底孔', operatorCrew: '运行二班', ownerCrew: '运行二班', openingAfter: 0, statusAfter: '已关闭', operatedAt: formatTime(hoursAgo(base, 26)) },
  ]
  return [...history, ...recent]
}

function cleanLedger(): CleanLedgerEntry[] {
  return [
    { id: 1, rackId: 1, rackNo: 'TRAS-0001', gateNo: 'GATE-0001', operator: '历史补记·清污班', crew: '清污班', cleanedAt: '2026-09-12 10:00:00', source: 'history-backfill', note: '早期记录无清理人，按清污责任班组补记' },
    { id: 2, rackId: 1, rackNo: 'TRAS-0001', gateNo: 'GATE-0001', operator: '周清污', crew: '清污班', cleanedAt: '2026-10-03 10:20:00' },
    { id: 3, rackId: 2, rackNo: 'TRAS-0002', gateNo: 'GATE-0002', operator: '历史补记·清污班', crew: '清污班', cleanedAt: '2026-09-20 14:00:00', source: 'history-backfill', note: '早期记录无清理人，按清污责任班组补记' },
    // 较晚产生的一条：快照还停在 1 次，对齐后以台账的 2 次为准。
    { id: 4, rackId: 2, rackNo: 'TRAS-0002', gateNo: 'GATE-0002', operator: '吴水清', crew: '清污班', cleanedAt: '2026-10-04 09:30:00' },
  ]
}

function gateAuths(base: number): GateAuth[] {
  return [
    // 仍在有效期：运行一班把 GATE-0003 借给检修班（到期自动收回）。
    {
      id: 1, gateId: 3, fromCrew: '运行一班', toCrew: '检修班',
      beginAt: formatTime(hoursAgo(base, 8)), expireAt: formatTime(hoursAgo(base, -4)),
      grantedBy: '张运行', reason: '调班期间检修班配合落表孔门', revoked: false,
    },
    // 已到期的历史授权：读取时自动判定失效。
    {
      id: 2, gateId: 1, fromCrew: '运行一班', toCrew: '检修班',
      beginAt: formatTime(hoursAgo(base, 56)), expireAt: formatTime(hoursAgo(base, 32)),
      grantedBy: '张运行', reason: '上月检修配合（已到期）', revoked: false,
    },
  ]
}

// 首次进入：把真实业务数据写入条目表与领域台账，只执行一次。
export function bootstrapDomain(force = false): void {
  const domain = getDomain()
  if (domain.bootstrappedAt && !force) {
    return
  }
  const base = Date.now()
  saveRows('gate', gateRows(base))
  saveRows('flood', floodRows())
  saveRows('trashrack', trashrackRows())
  saveRows('crew', crewRows())

  const next: DomainTables = {
    gateAuth: gateAuths(base) as unknown as DomainTables['gateAuth'],
    gateLedger: gateLedger(base) as unknown as DomainTables['gateLedger'],
    cleanLedger: cleanLedger() as unknown as DomainTables['cleanLedger'],
    reports: [],
    bootstrappedAt: formatTime(base),
  }
  saveDomain(next)
}
