// 规则验证：在 Node 里模拟 localStorage，引导种子后逐条跑业务约束。
// 仅用于本次开发自检，不打进前端产物。
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

// ---- 极简 localStorage 垫片 ----
const mem = new Map()
global.window = {
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  },
}

// ---- 即时把 TS 源码编译成 CJS 并 require（按 @ 别名映射）----
const FRONT = path.resolve(__dirname, '..')
const compileCache = new Map()

function loadTs(rel) {
  const file = path.resolve(FRONT, rel)
  if (compileCache.has(file)) return compileCache.get(file)
  const src = fs.readFileSync(file, 'utf8')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  }).outputText
  const mod = { exports: {} }
  compileCache.set(file, mod.exports)
  const localRequire = (spec) => {
    if (spec.startsWith('@/')) {
      return loadTs(`src/${spec.slice(2)}.ts`)
    }
    if (spec.startsWith('./') || spec.startsWith('../')) {
      const dir = path.dirname(file)
      let target = path.resolve(dir, spec)
      if (!fs.existsSync(target) && fs.existsSync(target + '.ts')) target += '.ts'
      if (target.endsWith('.ts')) return loadTs(path.relative(FRONT, target))
    }
    if (spec.endsWith('.json')) return require(spec)
    return require(spec)
  }
  new Function('require', 'module', 'exports', out)(localRequire, mod, mod.exports)
  return mod.exports
}

const bootstrap = loadTs('src/domain/bootstrap.ts')
const svc = loadTs('src/domain/gate-service.ts')
const flood = loadTs('src/domain/flood-service.ts')

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name} ${extra}`)
  }
}

bootstrap.bootstrapDomain(true)
svc.reconcile()

console.log('1) 归属与越权')
{
  // GATE-0001 归属运行一班；水情班既不是责任班组也没有任何授权 → OWNERSHIP
  const r = svc.operateGate({ gateId: 1, action: '开启闸门', operator: '郑调度', crew: '水情班' })
  check('水情班越权开启运行一班闸门被挡回', r.ok === false && r.code === 'OWNERSHIP', r.message)
  check('拒绝消息写清归属冲突', r.message.includes('归属冲突') && r.message.includes('运行一班'))

  // 检修班对 GATE-0001 有一条已到期的历史授权 → 按 AUTH_EXPIRED 挡回
  const expired = svc.operateGate({ gateId: 1, action: '开启闸门', operator: '赵检修', crew: '检修班' })
  check('有过期授权的班组操作按授权到期挡回', expired.ok === false && expired.code === 'AUTH_EXPIRED', expired.message)

  const ledger = svc.listGateLedger(1)
  check('越权提交写入操作记录（rejected/OWNERSHIP）', ledger.some((e) => e.result === 'rejected' && e.rejectCode === 'OWNERSHIP' && e.operatorCrew === '水情班'))
}

console.log('2) 责任班组正常启闭 + 开度同步泄洪孔数')
{
  // GATE-0005 当前关闭，运行二班开启 → 底孔B组孔数 +1
  const before = svc.totalOpenHoles()
  const r = svc.operateGate({ gateId: 5, action: '开启闸门', operator: '陈底孔', crew: '运行二班', opening: 40 })
  check('运行二班开启自家 GATE-0005 受理', r.ok === true, r.message)
  const holes = svc.openHoleCountByGroup()
  check('底孔B组开启孔数变为 2（0004+0005）', holes['底孔B组'] === 2, JSON.stringify(holes))
  check('总开启孔数较之前 +1', svc.totalOpenHoles() === before + 1)
  const floodRow = flood.listFlood().find((x) => String(x.泄洪闸号) === '底孔B组' && String(x.操作状态) !== '已结束')
  check('泄洪页最新票孔数同步为 2、状态泄洪中', Number(floodRow.开启孔数) === 2 && String(floodRow.操作状态) === '泄洪中', JSON.stringify({ h: floodRow.开启孔数, s: floodRow.操作状态 }))

  // 关掉后孔数回落
  svc.operateGate({ gateId: 5, action: '关闭闸门', operator: '陈底孔', crew: '运行二班' })
  const holes2 = svc.openHoleCountByGroup()
  check('关闭后底孔B组孔数回落到 1', holes2['底孔B组'] === 1)
}

console.log('3) 操作范围（登记故障只允许 all 范围）')
{
  // GATE-0004 范围 open-close，运行二班登记故障 → 范围冲突
  const r = svc.operateGate({ gateId: 4, action: '登记故障', operator: '王泄洪', crew: '运行二班' })
  check('操作范围不含故障登记时被挡回', r.ok === false && r.code === 'SCOPE', r.message)
  // GATE-0002 范围 all，运行一班可登记故障
  const r2 = svc.operateGate({ gateId: 2, action: '登记故障', operator: '李开启', crew: '运行一班' })
  check('范围为 all 的闸门允许登记故障', r2.ok === true, r2.message)
  // 恢复，避免污染后续统计
  svc.operateGate({ gateId: 2, action: '开启闸门', operator: '李开启', crew: '运行一班', opening: 100 })
}

console.log('4) 临时授权：借权可操作、归属仍记原班组、到期自动收回')
{
  // GATE-0006 是检修班的检修闸门，历史上最近没有任何开启动作，用它测借权，避开 5 分钟去重窗口。
  const now = Date.now()
  const pad = (n) => String(n).padStart(2, '0')
  const f = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  const g = svc.grantAuth({
    gateId: 6, toCrew: '清污班', fromCrew: '检修班',
    beginAt: f(new Date(now - 60000)), expireAt: f(new Date(now + 2 * 3600000)),
    grantedBy: '赵检修', reason: '测试借权',
  })
  check('责任班组可发放临时授权', g.ok, g.message)
  const r = svc.operateGate({ gateId: 6, action: '开启闸门', operator: '周清污', crew: '清污班', opening: 30 })
  check('借权班组授权期内可开启', r.ok, r.message)
  const entry = svc.listGateLedger(6).find((e) => e.operator === '周清污' && e.result === 'accepted')
  check('借权期间操作记录归属仍记原班组（检修班）', !!entry && entry.ownerCrew === '检修班' && entry.viaAuth === true)

  // 到期授权：登记一条已过期授权再尝试
  const exp = svc.grantAuth({
    gateId: 6, toCrew: '水情班', fromCrew: '检修班',
    beginAt: f(new Date(now - 3 * 3600000)), expireAt: f(new Date(now - 1000)),
    grantedBy: '赵检修', reason: '过期授权',
  })
  check('过期授权也能登记（用于留痕），但操作判定失效', exp.ok)
  const r2 = svc.operateGate({ gateId: 6, action: '关闭闸门', operator: '郑调度', crew: '水情班' })
  check('授权到期后自动收回，操作按授权到期挡回', r2.ok === false && r2.code === 'AUTH_EXPIRED', r2.message)

  // 借权班组不能再把操作权转给第三方
  const g2 = svc.grantAuth({
    gateId: 6, toCrew: '运行一班', fromCrew: '清污班',
    beginAt: f(new Date(now)), expireAt: f(new Date(now + 3600000)),
    grantedBy: '周清污', reason: '',
  })
  // grantAuth 不校验发放方（页面仅向责任班组开放入口）；此处验证运行一班拿这条授权也无效，
  // 因为授权链 fromCrew(清污班) ≠ 闸门责任班组(检修班)，canOperateGate 只认责任班组发出的授权。
  const r3 = svc.operateGate({ gateId: 6, action: '关闭闸门', operator: '张运行', crew: '运行一班' })
  check('非责任班组发出的转授权不产生操作权', r3.ok === false && r3.code === 'OWNERSHIP', r3.message)
  void g2
}

console.log('5) 同一时段重复操作 / 同一时刻并发只认第一条')
{
  // GATE-0003 已关闭：运行一班连续两次开启，第二次在 5 分钟窗口内 → DUP
  const a = svc.operateGate({ gateId: 3, action: '开启闸门', operator: '张运行', crew: '运行一班', opening: 50 })
  const b = svc.operateGate({ gateId: 3, action: '开启闸门', operator: '李开启', crew: '运行一班', opening: 70 })
  check('第一条开启受理', a.ok, a.message)
  check('同窗口第二条按重复拒绝', b.ok === false && b.code === 'DUP', b.message)
  const accepted = svc.listGateLedger(3).filter((e) => e.action === '开启闸门' && e.result === 'accepted')
  check('台账中该时段只保留一笔受理（开度 50 不被 70 覆盖）', accepted[0].openingAfter === 50)
}

console.log('6) 归属登记只允许责任班组改')
{
  const r = svc.updateOwnership({ gateId: 1, crew: '检修班', operator: '赵检修', ownerCrew: '检修班' })
  check('非责任班组改归属被拒', r.ok === false && r.code === 'OWNERSHIP', r.message)
  const r2 = svc.updateOwnership({ gateId: 1, crew: '运行一班', operator: '张运行', ownerCrew: '运行二班', scope: '仅开启' })
  check('责任班组可以移交归属', r2.ok, r2.message)
  // 移交后运行一班失去权限
  const r3 = svc.operateGate({ gateId: 1, action: '关闭闸门', operator: '张运行', crew: '运行一班' })
  check('移交后原班组再操作被挡回', r3.ok === false && r3.code === 'OWNERSHIP')
  // 还原
  svc.updateOwnership({ gateId: 1, crew: '运行二班', operator: '王泄洪', ownerCrew: '运行一班', scope: '开启/关闭' })
}

console.log('7) 泄洪审批归属 + 孔数联动校验')
{
  const other = flood.operateFlood({ id: 2, action: '结束泄洪', operator: '赵检修', crew: '检修班' })
  check('非责任班组不能结束泄洪', other.ok === false && other.code === 'OWNERSHIP', other.message)
  // 底孔B组当前 0004 开着，运行二班结束泄洪应被孔数校验拦下
  const open = flood.operateFlood({ id: 2, action: '结束泄洪', operator: '王泄洪', crew: '运行二班' })
  check('闸门仍开着时禁止结束泄洪', open.ok === false && open.code === 'VALIDATION', open.message)
}

console.log('8) 拦污栅台账：跨页清污条数相同、重复提交只留一笔')
{
  const before = svc.cleanCountByRack()[3] ?? 0
  const a = svc.recordCleaning({ rackId: 3, operator: '周清污', crew: '清污班' })
  const b = svc.recordCleaning({ rackId: 3, operator: '吴水清', crew: '清污班' })
  check('第一笔清污受理', a.ok, a.message)
  check('同窗口第二笔按重复拒绝', b.ok === false && b.code === 'DUP', b.message)
  const rackCount = svc.cleanCountByRack()[3]
  const gateCount = svc.cleanCountByGate()['GATE-0004']
  check('拦污栅口径与闸门台账口径条数一致（TRAS-0003=1 且 GATE-0004 累计含此条）', rackCount === before + 1 && gateCount >= 1, `rack=${rackCount} gate=${gateCount}`)
}

console.log('9) 争议取值：以较晚产生的为准并统一')
{
  const reports = svc.listReports()
  const floodConflict = reports.find((r) => r.id === 'conflict-flood-2')
  check('泄洪旧票 0 孔 vs 闸门开 1 孔产出对齐报告', !!floodConflict && floodConflict.resolvedValue === '1 孔')
  const fr = flood.listFlood().find((x) => Number(x.id) === 2)
  check('泄洪票孔数已统一为 1、状态泄洪中', Number(fr.开启孔数) === 1 && String(fr.操作状态) === '泄洪中', JSON.stringify({ h: fr.开启孔数, s: fr.操作状态 }))
  const trashConflict = reports.find((r) => r.id === 'conflict-trashrack-2')
  check('拦污栅快照 1 条 vs 台账 2 条，统一为 2', !!trashConflict && trashConflict.resolvedValue === '2 条')
  const gateSync = reports.find((r) => r.id === 'sync-gate-clean-GATE-0002')
  check('闸门页清污条数同步说明存在', !!gateSync && gateSync.resolvedValue === '2 条')
}

console.log('10) 历史数据按业务日期回填、缺项单独罗列')
{
  const reports = svc.listReports()
  const backfill = reports.filter((r) => r.kind === 'backfill')
  check('无操作人记录按责任班组补记（含运行一/二班、检修班、清污班）', backfill.some((r) => r.detail.includes('运行一班')) && backfill.some((r) => r.detail.includes('清污班')))
  const missing = reports.filter((r) => r.kind === 'missing')
  const gate6 = missing.find((r) => r.target === 'GATE-0006' && r.detail.includes('孔口尺寸'))
  check('GATE-0006 孔口尺寸缺失被单独罗列', !!gate6)
}

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
