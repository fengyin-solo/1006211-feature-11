<template>
  <section class="page" data-module="gate">
    <header class="page-head">
      <div>
        <h2>闸门启闭管理</h2>
        <p class="page-desc">闸门归属到责任班组：本班组（含生效临时授权）才能启闭，越权一律拒绝；开度实时同步泄洪孔数口径。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="showRules = true">归属与同步规则</button>
        <button class="btn" type="button" @click="showLogs = true">操作记录</button>
        <button class="btn" type="button" @click="showGrants = true">临时授权</button>
        <button class="btn" type="button" @click="showMissing = true">历史缺项（{{ missing.length }}）</button>
        <button class="btn primary" type="button" @click="openCreate">登记闸门</button>
      </div>
    </header>

    <div class="rule-banner">
      当前身份：<strong>{{ session.actor.name }}（{{ crewName(session.actor.crewCode) }} · {{ session.actor.role }}）</strong>
      <template v-if="session.isReadonly">
        ｜观测岗只读：仅可查看孔口尺寸、启闭机信息与归属，任何启闭、故障、归属变更一律拒绝。
      </template>
      <template v-else>
        ｜只能操作归属{{ crewName(session.actor.crewCode) }}的闸门；其他班组的闸门点动作会被挡回并提示归属冲突。
      </template>
    </div>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">开启闸门（实测）</span>
        <strong class="stat-value">{{ stats.open }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已关闭</span>
        <strong class="stat-value">{{ stats.closed }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">故障闸门</span>
        <strong class="stat-value">{{ stats.fault }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">同步到泄洪页的开启孔数</span>
        <strong class="stat-value">{{ stats.holes }} 孔</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">跨页统一清污条数</span>
        <strong class="stat-value">{{ cleaningTotal }} 条</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>闸门编号</span>
        <input v-model="filters.keyword" placeholder="按闸门编号检索" />
      </label>
      <label class="filter-item">
        <span>闸段</span>
        <input v-model="filters.bay" placeholder="按闸段检索" />
      </label>
      <label class="filter-item">
        <span>责任班组</span>
        <select v-model="filters.crew">
          <option value="">全部</option>
          <option v-for="crew in ownableCrews" :key="crew.code" :value="crew.code">{{ crew.name }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>闸门编号</th>
          <th>类型</th>
          <th>孔口尺寸</th>
          <th>当前开度</th>
          <th>启闭机型号</th>
          <th>责任班组</th>
          <th>操作范围</th>
          <th>闸段</th>
          <th>最近操作人/时间</th>
          <th>状态</th>
          <th>操作（{{ session.isReadonly ? '只读' : '按归属放行' }}）</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in pagedRows" :key="row.id" :class="{ 'is-readonly-row': !can(row) }">
          <td>{{ row.闸门编号 }}</td>
          <td>{{ row.闸门类型 }}</td>
          <td>{{ row.孔口尺寸 }}</td>
          <td>{{ row.当前开度 }} m</td>
          <td>{{ row.启闭机型号 }}</td>
          <td>
            {{ crewName(row.责任班组) }}
            <span v-if="borrowOf(row)" class="tag tag-loan">
              借用：{{ crewName(borrowOf(row)!.借用班组) }}
            </span>
          </td>
          <td>{{ row.操作范围 }}</td>
          <td>{{ row.闸段 }}{{ row.参与泄洪 ? '' : '（不参与泄洪）' }}</td>
          <td>
            <div>{{ row.操作人员 || '—' }}</div>
            <div class="cell-sub">{{ row.操作时间 }}</div>
          </td>
          <td>
            <span :class="['status-pill', statusClass(row.闸门状态)]">{{ row.闸门状态 }}</span>
          </td>
          <td class="row-actions action-cell">
            <template v-if="session.isReadonly">
              <span class="muted-link" title="观测岗只读">只读</span>
            </template>
            <template v-else>
              <button class="link" type="button" @click="askOpen(row)">开启</button>
              <button class="link" type="button" @click="call(() => operateGate({ gateId: row.id, action: '关闭闸门', actor: session.actor }))">关闭</button>
              <button class="link" type="button" @click="askFault(row)">登记故障</button>
              <button class="link" type="button" @click="openGrant(row)">借用授权</button>
              <button class="link" type="button" @click="openReassign(row)">改归属/范围</button>
            </template>
          </td>
        </tr>
        <tr v-if="!pagedRows.length">
          <td colspan="11" class="empty-state">暂无符合条件的闸门</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 扇闸门</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <!-- 开启开度输入 -->
    <Modal :open="openingModal" title="开启闸门" @close="openingModal = false">
      <div class="form-row">
        <label>闸门</label>
        <div>{{ activeGate?.闸门编号 }}（{{ activeGate ? crewName(activeGate.责任班组) : '' }} · {{ activeGate?.操作范围 }}）</div>
      </div>
      <div class="form-row">
        <label>目标开度（米，正整数）</label>
        <input v-model.number="openingValue" type="number" min="1" step="1" />
      </div>
      <template #footer>
        <button class="btn" type="button" @click="openingModal = false">取消</button>
        <button class="btn primary" type="button" @click="confirmOpen">确认开启</button>
      </template>
    </Modal>

    <!-- 故障说明 -->
    <Modal :open="faultModal" title="登记闸门故障" @close="faultModal = false">
      <div class="form-row">
        <label>闸门</label>
        <div>{{ activeGate?.闸门编号 }}</div>
      </div>
      <div class="form-row">
        <label>故障说明</label>
        <textarea v-model="faultNote" rows="3" placeholder="如：启闭机钢丝绳断丝，无法到位"></textarea>
      </div>
      <template #footer>
        <button class="btn" type="button" @click="faultModal = false">取消</button>
        <button class="btn primary" type="button" @click="confirmFault">确认登记（仅责任班组）</button>
      </template>
    </Modal>

    <!-- 临时授权 -->
    <Modal :open="grantModal" title="调班临时授权" @close="grantModal = false">
      <div class="form-row">
        <label>闸门</label>
        <div>{{ activeGate?.闸门编号 }}（原责任班组：{{ activeGate ? crewName(activeGate.责任班组) : '' }}）</div>
      </div>
      <div class="form-row">
        <label>借用班组（操作记录仍归原班组）</label>
        <select v-model="grantForm.crewCode">
          <option v-for="crew in borrowCrewOptions" :key="crew.code" :value="crew.code">
            {{ crew.name }}（{{ crew.role }}）
          </option>
        </select>
      </div>
      <div class="form-row">
        <label>授权开始</label>
        <input v-model="grantForm.start" type="datetime-local" />
      </div>
      <div class="form-row">
        <label>授权到期（到期自动收回）</label>
        <input v-model="grantForm.expire" type="datetime-local" />
      </div>
      <div class="quick-row">
        <button class="btn ghost" type="button" @click="setQuickExpire(1 / 24)">1 小时</button>
        <button class="btn ghost" type="button" @click="setQuickExpire(2)">2 小时</button>
        <button class="btn ghost" type="button" @click="setQuickExpire(24)">1 天</button>
        <button class="btn ghost" type="button" @click="setQuickExpire(24 * 30)">30 天</button>
      </div>
      <div class="form-row">
        <label>调班/借用原因</label>
        <textarea v-model="grantForm.reason" rows="2" placeholder="如：夜班调班，乙班替班"></textarea>
      </div>
      <template #footer>
        <button class="btn" type="button" @click="grantModal = false">取消</button>
        <button class="btn primary" type="button" @click="confirmGrant">登记授权</button>
      </template>
    </Modal>

    <!-- 归属变更 -->
    <Modal :open="reassignModal" title="调整责任班组与操作范围" @close="reassignModal = false">
      <div class="form-row">
        <label>闸门</label>
        <div>{{ activeGate?.闸门编号 }}</div>
      </div>
      <div class="form-row">
        <label>责任班组（归属只有现责任班组能改）</label>
        <select v-model="reassignForm.crewCode">
          <option v-for="crew in ownableCrews" :key="crew.code" :value="crew.code">{{ crew.name }}（{{ crew.role }}）</option>
        </select>
      </div>
      <div class="form-row">
        <label>操作范围</label>
        <input v-model="reassignForm.scope" placeholder="表孔 / 深孔 / 检修" />
      </div>
      <template #footer>
        <button class="btn" type="button" @click="reassignModal = false">取消</button>
        <button class="btn primary" type="button" @click="confirmReassign">确认变更</button>
      </template>
    </Modal>

    <!-- 规则说明 -->
    <Modal :open="showRules" title="归属与同步规则" @close="showRules = false">
      <ul class="rule-list">
        <li>每扇闸门登记责任班组与操作范围；开启、关闭只认本班组，越权提交一律拒绝并返回归属冲突说明。</li>
        <li>调班借用通过临时授权：有开始/到期时间，到期自动收回；授权期间操作记录仍归原班组，记录里同时留实际操作班组与授权依据。</li>
        <li>开启后当前开度按闸段折算「开启孔数」，实时同步泄洪操作页；两套取值并存时以产生时间较晚的一套为准，并把另一侧统一过来。</li>
        <li>提交审批、登记故障、改归属只允许责任班组；观测岗只读孔口尺寸、启闭机信息与归属，不允许任何写操作。</li>
        <li>同一扇闸门同一时段（一分钟）同方向重复操作只认第一条，后到的按重复拒绝；同一时刻并发写入只保留一笔。</li>
        <li>清污结果同步拦污栅台账，跨页清污条数相同；历史操作记录按操作时间回填，无操作人的按闸门责任班组补记。</li>
      </ul>
    </Modal>

    <!-- 操作记录 -->
    <Modal :open="showLogs" title="闸门操作记录（按操作时间倒序）" @close="showLogs = false">
      <table class="data-table inner-table">
        <thead>
          <tr><th>时间</th><th>闸门</th><th>操作</th><th>开度</th><th>实际操作人</th><th>归属班组</th><th>授权依据</th><th>结果</th></tr>
        </thead>
        <tbody>
          <tr v-for="log in logs" :key="log.id" :class="{ 'log-denied': log.结果 === '已拒绝' }">
            <td>{{ log.操作时间 }}</td>
            <td>{{ log.闸门编号 }}</td>
            <td>{{ log.操作类型 }}</td>
            <td>{{ log.操作开度 }}</td>
            <td>{{ log.实际操作人 }}</td>
            <td>{{ crewName(log.归属班组) }}</td>
            <td class="cell-sub">{{ log.授权依据 }}</td>
            <td>{{ log.结果 }}<div v-if="log.来源" class="cell-sub">{{ log.来源 }}</div></td>
          </tr>
        </tbody>
      </table>
    </Modal>

    <!-- 授权列表 -->
    <Modal :open="showGrants" title="临时授权台账（到期自动收回）" @close="showGrants = false">
      <table class="data-table inner-table">
        <thead>
          <tr><th>闸门</th><th>原班组</th><th>借用班组/人</th><th>开始</th><th>到期</th><th>状态</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="grant in grants" :key="grant.id">
            <td>{{ grant.闸门编号 }}</td>
            <td>{{ crewName(grant.原班组) }}</td>
            <td>{{ crewName(grant.借用班组) }}<div class="cell-sub">{{ grant.借用人 }}</div></td>
            <td>{{ fmt(grant.授权开始) }}</td>
            <td>{{ fmt(grant.授权到期) }}</td>
            <td>{{ grant.状态 }}</td>
            <td>
              <button v-if="grant.状态 === '生效中' && !session.isReadonly" class="link" type="button" @click="doRevoke(grant.id)">提前收回</button>
            </td>
          </tr>
        </tbody>
      </table>
    </Modal>

    <!-- 缺项清单 -->
    <Modal :open="showMissing" title="历史补数缺项清单" @close="showMissing = false">
      <p class="page-desc">历史数据按业务日期补数；无法推算的字段不臆造，单独罗列在此，待责任班组补登记。</p>
      <table class="data-table inner-table">
        <thead>
          <tr><th>来源</th><th>编号</th><th>缺失字段</th><th>补数办法</th><th>补入值</th><th>业务日期</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in missing" :key="item.id">
            <td>{{ item.来源模块 }}</td>
            <td>{{ item.来源编号 }}</td>
            <td>{{ item.缺失字段 }}</td>
            <td class="cell-sub">{{ item.补数办法 }}</td>
            <td>{{ item.补入值 }}</td>
            <td>{{ item.业务日期 }}</td>
          </tr>
          <tr v-if="!missing.length"><td colspan="6" class="empty-state">无缺项</td></tr>
        </tbody>
      </table>
    </Modal>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { listRows } from '@/data/local-store'
import Modal from '@/components/Modal.vue'
import {
  createGrant,
  listGateGrants,
  listGateLogs,
  operateGate,
  reassignGate,
  reportGateFault,
  revokeGrant,
} from '@/domain/gate-service'
import { listMissingFields } from '@/domain/queries'
import { CREWS, crewName } from '@/domain/identity'
import { activeGrant } from '@/domain/ownership'
import { canonicalCleaningTotal } from '@/domain/trashrack-service'
import { useNoticeStore } from '@/stores/notice'
import { useSessionStore } from '@/stores/session'
import type { ActionResult, Actor, GateLogRow, GateRow, GrantRow } from '@/domain/types'

const session = useSessionStore()
const notice = useNoticeStore()

const ownableCrews = CREWS.filter((crew) => crew.role !== '观测岗')

const rows = ref<GateRow[]>([])
const logs = ref<GateLogRow[]>([])
const grants = ref<GrantRow[]>([])
const missing = ref(listMissingFields())
const cleaningTotal = ref(canonicalCleaningTotal())
const message = ref('')
const messageOk = ref(false)
const filters = reactive({ keyword: '', bay: '', crew: '' })

const showRules = ref(false)
const showLogs = ref(false)
const showGrants = ref(false)
const showMissing = ref(false)

const openingModal = ref(false)
const faultModal = ref(false)
const grantModal = ref(false)
const reassignModal = ref(false)
const activeGate = ref<GateRow | null>(null)
const openingValue = ref(1)
const faultNote = ref('')
const grantForm = reactive({ crewCode: 'RUN-B', start: '', expire: '', reason: '' })
const reassignForm = reactive({ crewCode: '', scope: '' })

const pagedRows = computed(() =>
  rows.value.filter((row) => {
    if (filters.keyword && !row.闸门编号.includes(filters.keyword.trim())) return false
    if (filters.bay && !row.闸段.includes(filters.bay.trim())) return false
    if (filters.crew && row.责任班组 !== filters.crew) return false
    return true
  }),
)

const stats = computed(() => ({
  open: rows.value.filter((row) => row.当前开度 > 0).length,
  closed: rows.value.filter((row) => row.当前开度 === 0 && row.闸门状态 !== '故障').length,
  fault: rows.value.filter((row) => row.闸门状态 === '故障').length,
  holes: rows.value.filter((row) => row.参与泄洪 && row.当前开度 > 0).length,
}))

const borrowCrewOptions = computed(() =>
  ownableCrews.filter((crew) => activeGate.value && crew.code !== activeGate.value.责任班组),
)

function can(row: GateRow): boolean {
  if (session.isReadonly) return false
  if (row.责任班组 === session.actor.crewCode) return true
  return Boolean(activeGrant(row.id)?.借用班组 === session.actor.crewCode)
}

function borrowOf(row: GateRow): GrantRow | undefined {
  const grant = activeGrant(row.id)
  return grant && grant.状态 === '生效中' ? grant : undefined
}

function statusClass(status: string): string {
  if (status === '运行中') return 'pill-open'
  if (status === '故障') return 'pill-fault'
  return 'pill-closed'
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

function call(fn: () => ActionResult): void {
  const result = fn()
  message.value = result.message
  messageOk.value = result.ok
  reload()
  notice.refresh()
}

function reload(): void {
  rows.value = listGatesFresh()
  logs.value = listGateLogs()
  grants.value = listGateGrants()
  missing.value = listMissingFields()
  cleaningTotal.value = canonicalCleaningTotal()
}

// 直接走数据层重读，避免页面持有旧引用。
function listGatesFresh(): GateRow[] {
  return listRows('gate') as unknown as GateRow[]
}

function resetFilters(): void {
  filters.keyword = ''
  filters.bay = ''
  filters.crew = ''
}

function openCreate(): void {
  message.value = '闸门登记需先指定责任班组与操作范围，演示数据已内置 7 扇闸门'
  messageOk.value = false
}

function askOpen(row: GateRow): void {
  activeGate.value = row
  openingValue.value = 1
  openingModal.value = true
}
function confirmOpen(): void {
  if (!activeGate.value) return
  openingModal.value = false
  call(() => operateGate({ gateId: activeGate.value!.id, action: '开启闸门', actor: session.actor, opening: openingValue.value }))
}

function askFault(row: GateRow): void {
  activeGate.value = row
  faultNote.value = ''
  faultModal.value = true
}
function confirmFault(): void {
  if (!activeGate.value) return
  faultModal.value = false
  call(() => reportGateFault(activeGate.value!.id, session.actor, faultNote.value))
}

function openGrant(row: GateRow): void {
  activeGate.value = row
  grantForm.crewCode = borrowCrewOptions.value[0]?.code ?? ''
  grantForm.start = toLocalInput(new Date())
  grantForm.expire = toLocalInput(new Date(Date.now() + 2 * 3600 * 1000))
  grantForm.reason = ''
  grantModal.value = true
}
function setQuickExpire(hours: number): void {
  grantForm.expire = toLocalInput(new Date(Date.now() + hours * 3600 * 1000))
}
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
function confirmGrant(): void {
  if (!activeGate.value) return
  const borrower: Actor = {
    ...session.actor,
    crewCode: grantForm.crewCode,
    name: CREWS.find((crew) => crew.code === grantForm.crewCode)?.name ?? '借用人',
    role: CREWS.find((crew) => crew.code === grantForm.crewCode)?.role ?? '运行岗',
  }
  grantModal.value = false
  call(() =>
    createGrant(session.actor, {
      gateId: activeGate.value!.id,
      borrower,
      reason: grantForm.reason,
      startIso: new Date(grantForm.start).toISOString(),
      expireIso: new Date(grantForm.expire).toISOString(),
    }),
  )
}
function doRevoke(id: number): void {
  call(() => revokeGrant(id, session.actor))
}

function openReassign(row: GateRow): void {
  activeGate.value = row
  reassignForm.crewCode = row.责任班组
  reassignForm.scope = row.操作范围
  reassignModal.value = true
}
function confirmReassign(): void {
  if (!activeGate.value) return
  reassignModal.value = false
  call(() =>
    reassignGate(activeGate.value!.id, session.actor, {
      责任班组: reassignForm.crewCode,
      操作范围: reassignForm.scope,
    }),
  )
}

onMounted(() => {
  reload()
  notice.refresh()
})
</script>

<style scoped>
.rule-banner {
  background: #eef5ff;
  border: 1px solid #bfd7ff;
  color: #1e4a8a;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  margin-bottom: 12px;
}
.tag {
  display: inline-block;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  margin-left: 4px;
}
.tag-loan {
  background: #fff4e0;
  color: #9a5b00;
}
.status-pill {
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
}
.pill-open { background: #e3f9ec; color: #067647; }
.pill-closed { background: #eef2f7; color: #475569; }
.pill-fault { background: #fdecec; color: #b42318; }
.cell-sub { color: var(--muted); font-size: 11px; }
.muted-link { color: var(--muted); font-size: 12px; }
.is-readonly-row { background: #fafbfc; }
.action-cell { white-space: nowrap; }
.inner-table { font-size: 12px; }
.inner-table th, .inner-table td { padding: 6px 8px; }
.log-denied { color: #b42318; }
.ok-text { color: #067647; }
.quick-row { display: flex; gap: 6px; margin-bottom: 10px; }
.rule-list { padding-left: 18px; font-size: 13px; line-height: 1.9; }
</style>
