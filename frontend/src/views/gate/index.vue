<template>
  <section class="page" data-module="gate">
    <NoticePanel />

    <header class="page-head">
      <div>
        <h2>闸门启闭管理</h2>
        <p class="page-desc">
          每扇闸门登记责任班组与操作范围：只有本班组（或持有效临时授权的借权班组）能对归属闸门开启、关闭、登记故障；越权提交一律挡回并写清归属冲突。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出闸门清单</button>
        <button class="btn" type="button" @click="runReconcile">立即对账统一取值</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">当前开启孔数（泄洪同口径）：{{ totalHoles }}</span>
    </p>

    <p class="readonly-hint">
      当前值班：<strong>{{ session.operator }}</strong>（{{ session.crewName }}·{{ session.postName }}）。
      归属到班组：非责任班组对闸门只读，只能查看孔口尺寸与启闭机信息，不能启闭、不能登记故障、不能改归属。
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>关联清污条数</th>
          <th>当前状态</th>
          <th>我的权限</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '当前开度'">
              <span class="opening-bar">
                <span class="opening-track"><span class="opening-fill" :style="{ width: `${Number(row[column]) || 0}%` }"></span></span>
                {{ row[column] ?? 0 }}%
              </span>
            </template>
            <template v-else-if="column === '责任班组'">
              <span class="badge owner">{{ row[column] }}</span>
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ cleanCounts[String(row.闸门编号)] ?? 0 }} 条</td>
          <td>{{ row.status }}</td>
          <td>
            <span v-if="perm(row).allowed" class="badge" :class="perm(row).viaAuth ? 'borrow' : 'owner'">
              {{ perm(row).viaAuth ? `借权（${session.crewName}）` : '本班组可操作' }}
            </span>
            <span v-else class="badge readonly">只读</span>
          </td>
          <td class="row-actions">
            <template v-if="perm(row).allowed">
              <button class="link" type="button" @click="askOpening(row)">开启闸门</button>
              <button class="link" type="button" @click="doAction('关闭闸门', row)">关闭闸门</button>
              <button class="link" type="button" @click="doAction('登记故障', row)">登记故障</button>
              <button class="link" type="button" @click="openGrant(row)">临时授权</button>
              <button class="link" type="button" @click="openOwnership(row)" v-if="String(row.责任班组) === session.crewName">改归属</button>
            </template>
            <span v-else class="muted">仅责任班组可操作</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无闸门数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 扇闸门</span>
      <span v-if="message" :class="messageOk ? '' : 'error-text'">{{ message }}</span>
    </footer>

    <!-- 开启开度录入 -->
    <div v-if="openingTarget" class="sub-panel">
      <h3>开启闸门 {{ openingTarget.gate.闸门编号 }}（归属：{{ openingTarget.gate.责任班组 }}）</h3>
      <div class="filter-bar">
        <label class="filter-item">
          <span>目标开度（%，1—100）</span>
          <input v-model.number="openingTarget.opening" type="number" min="1" max="100" />
        </label>
        <button class="btn primary" type="button" @click="confirmOpening">确认开启</button>
        <button class="btn ghost" type="button" @click="openingTarget = null">取消</button>
      </div>
    </div>

    <!-- 临时授权 -->
    <div v-if="grantTarget" class="sub-panel">
      <h3>临时借用操作权 · {{ grantTarget.闸门编号 }}</h3>
      <p class="page-desc">责任班组 {{ grantTarget.责任班组 }} 授权；授权到期自动收回，授权期间操作记录仍归原班组。</p>
      <div class="filter-bar">
        <label class="filter-item">
          <span>借入班组</span>
          <select v-model="grantForm.toCrew">
            <option v-for="name in borrowableCrews(grantTarget)" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>开始时间</span>
          <input v-model="grantForm.beginAt" type="datetime-local" />
        </label>
        <label class="filter-item">
          <span>到期时间</span>
          <input v-model="grantForm.expireAt" type="datetime-local" />
        </label>
        <label class="filter-item">
          <span>借权事由</span>
          <input v-model="grantForm.reason" placeholder="调班配合等" />
        </label>
        <button class="btn primary" type="button" @click="confirmGrant">发放授权</button>
        <button class="btn ghost" type="button" @click="grantTarget = null">取消</button>
      </div>
    </div>

    <!-- 归属登记修改 -->
    <div v-if="ownTarget" class="sub-panel">
      <h3>归属登记 · {{ ownTarget.闸门编号 }}（仅{{ ownTarget.责任班组 }}可改）</h3>
      <div class="filter-bar">
        <label class="filter-item">
          <span>责任班组</span>
          <select v-model="ownForm.ownerCrew">
            <option v-for="name in CREW_NAMES" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>操作范围</span>
          <select v-model="ownForm.scope">
            <option v-for="scope in SCOPE_OPTIONS" :key="scope" :value="SCOPE_LABELS[scope]">{{ SCOPE_LABELS[scope] }}</option>
          </select>
        </label>
        <button class="btn primary" type="button" @click="confirmOwnership">保存归属</button>
        <button class="btn ghost" type="button" @click="ownTarget = null">取消</button>
      </div>
    </div>

    <!-- 临时授权清单 -->
    <section class="sub-panel">
      <h3>临时授权台账（到期自动收回）</h3>
      <table class="data-table">
        <thead>
          <tr><th>闸门</th><th>授权方</th><th>借入方</th><th>开始</th><th>到期</th><th>事由</th><th>状态</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="auth in auths" :key="auth.id">
            <td>{{ gateNo(auth.gateId) }}</td>
            <td>{{ auth.fromCrew }}</td>
            <td>{{ auth.toCrew }}</td>
            <td>{{ auth.beginAt }}</td>
            <td>{{ auth.expireAt }}</td>
            <td>{{ auth.reason }}</td>
            <td><span class="badge" :class="auth.active ? 'owner' : auth.revoked ? 'readonly' : 'blocked'">{{ auth.state }}</span></td>
            <td>
              <button v-if="auth.active && canRevoke(auth)" class="link" type="button" @click="doRevoke(auth.id)">提前收回</button>
              <span v-else class="muted">—</span>
            </td>
          </tr>
          <tr v-if="!auths.length"><td colspan="8" class="empty-state">暂无临时授权</td></tr>
        </tbody>
      </table>
    </section>

    <!-- 操作记录 -->
    <section class="sub-panel">
      <h3>闸门操作记录（按操作时间倒序；重复/越权提交全部留痕）</h3>
      <table class="data-table">
        <thead>
          <tr><th>操作时间</th><th>闸门</th><th>动作</th><th>结果</th><th>操作人</th><th>操作人班组</th><th>归属班组</th><th>开度/状态</th><th>说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="entry in ledger" :key="entry.id">
            <td>{{ entry.operatedAt }}</td>
            <td>{{ entry.gateNo }}</td>
            <td>{{ entry.action }}</td>
            <td>
              <span class="badge" :class="entry.result === 'accepted' ? 'owner' : 'blocked'">
                {{ entry.result === 'accepted' ? '已受理' : `已拒绝（${rejectText(entry.rejectCode)}）` }}
              </span>
              <span v-if="entry.viaAuth" class="badge borrow">借权</span>
            </td>
            <td>{{ entry.operator }}</td>
            <td>{{ entry.operatorCrew }}</td>
            <td>{{ entry.ownerCrew }}</td>
            <td>{{ entry.openingAfter }}% / {{ entry.statusAfter }}</td>
            <td>{{ entry.note ?? (entry.source === 'history-backfill' ? '历史回填' : '') }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 对账与缺项 -->
    <section class="sub-panel">
      <h3>历史补数 / 争议取值对齐 / 缺项清单</h3>
      <p class="page-desc">两套取值并存且有争议时，以较晚产生的一套为准并统一；历史按业务日期补数，缺失字段单独罗列。</p>
      <table class="data-table">
        <thead>
          <tr><th>类型</th><th>模块</th><th>对象</th><th>说明</th><th>统一/补记结果</th><th>时间</th></tr>
        </thead>
        <tbody>
          <tr v-for="report in reports" :key="report.id">
            <td><span class="badge" :class="report.kind === 'conflict' ? 'blocked' : report.kind === 'backfill' ? 'owner' : 'readonly'">{{ kindText(report.kind) }}</span></td>
            <td>{{ report.module }}</td>
            <td>{{ report.target }}</td>
            <td>{{ report.detail }}</td>
            <td>{{ report.resolvedValue ?? '—' }}</td>
            <td>{{ report.happenedAt }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'
import { useNoticeStore } from '@/stores/notice'
import NoticePanel from '@/components/NoticePanel.vue'
import { CREW_NAMES } from '@/domain/constants'
import {
  canOperateGate,
  cleanCountByGate,
  grantAuth,
  listAuths,
  listGateLedger,
  listReports,
  operateGate,
  reconcile,
  revokeAuth,
  updateOwnership,
  totalOpenHoles,
  type AuthView,
} from '@/domain/gate-service'
import { SCOPE_LABELS, SCOPE_OPTIONS } from '@/domain/bootstrap'
import { nowText } from '@/domain/time'

const meta = moduleMeta('gate')
const session = useSessionStore()
const notice = useNoticeStore()

const columns = ['闸门编号', '闸门类型', '孔口尺寸', '当前开度', '启闭机型号', '泄洪闸组', '责任班组', '操作范围', '操作人员', '操作时间']
const statuses = ['待操作', '运行中', '已关闭', '故障']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const message = ref('')
const messageOk = ref(true)
const filters = ref<Record<string, string>>({})
const filterFields = ['闸门编号', '闸门类型', '责任班组']
const auths = ref<AuthView[]>([])
const ledger = ref(listGateLedger())
const reports = ref(listReports())
const cleanCounts = ref<Record<string, number>>({})
const totalHoles = ref(0)

const stats = computed(() => [
  { label: '开启闸门', value: rows.value.filter((row) => Number(row.当前开度) > 0).length },
  { label: '关闭闸门', value: rows.value.filter((row) => Number(row.当前开度) === 0).length },
  { label: '故障闸门', value: rows.value.filter((row) => String(row.status) === '故障').length },
  { label: '当前开启孔数', value: totalHoles.value },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function perm(row: EntryRow) {
  return canOperateGate(row, session.crewName)
}

function gateNo(id: number): string {
  return String(rows.value.find((row) => Number(row.id) === id)?.闸门编号 ?? `#${id}`)
}

function canRevoke(auth: AuthView): boolean {
  const gate = rows.value.find((row) => Number(row.id) === auth.gateId)
  return !!gate && String(gate.责任班组) === session.crewName
}

function borrowableCrews(gate: EntryRow): string[] {
  return CREW_NAMES.filter((name) => name !== String(gate.责任班组))
}

function rejectText(code?: string): string {
  return ({ OWNERSHIP: '归属冲突', SCOPE: '范围冲突', AUTH_EXPIRED: '授权到期', DUP: '重复操作', VALIDATION: '校验不通过' })[code ?? ''] ?? '冲突'
}

function kindText(kind: string): string {
  return ({ conflict: '争议对齐', backfill: '历史补数', missing: '缺项待补' })[kind] ?? kind
}

function notify(text: string, ok = true) {
  message.value = text
  messageOk.value = ok
}

function reload() {
  message.value = ''
  const payload = listEntries(meta.key, filters.value)
  rows.value = payload.items
  total.value = payload.total
  auths.value = listAuths()
  ledger.value = listGateLedger()
  reports.value = listReports()
  cleanCounts.value = cleanCountByGate()
  totalHoles.value = totalOpenHoles()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runReconcile() {
  reconcile()
  reload()
  notice.refresh(session.crewName)
  notify('已按「较晚产生的取值为准」完成统一，跨页口径一致')
}

// ---- 开启 ----
const openingTarget = ref<{ gate: EntryRow; opening: number } | null>(null)
function askOpening(row: EntryRow) {
  openingTarget.value = { gate: row, opening: 100 }
}
function confirmOpening() {
  if (!openingTarget.value) {
    return
  }
  const { gate, opening } = openingTarget.value
  const result = operateGate({ gateId: Number(gate.id), action: '开启闸门', operator: session.operator, crew: session.crewName, opening })
  openingTarget.value = null
  afterMutation(result)
}

function doAction(action: string, row: EntryRow) {
  const result = operateGate({ gateId: Number(row.id), action, operator: session.operator, crew: session.crewName })
  afterMutation(result)
}

function afterMutation(result: { ok: boolean; message: string }) {
  reload()
  notice.refresh(session.crewName)
  notify(result.message, result.ok)
}

// ---- 授权 ----
const grantTarget = ref<EntryRow | null>(null)
const grantForm = ref({ toCrew: '', beginAt: '', expireAt: '', reason: '' })

function toLocalInput(text: string): string {
  return text.length === 19 ? text.slice(0, 16) : text
}

function openGrant(row: EntryRow) {
  if (String(row.责任班组) !== session.crewName) {
    notify('归属冲突：只有责任班组能发放临时授权，借权班组不能再转授权', false)
    return
  }
  const begin = new Date()
  const end = new Date(begin.getTime() + 8 * 3600 * 1000)
  grantTarget.value = row
  grantForm.value = {
    toCrew: borrowableCrews(row)[0] ?? '',
    beginAt: toLocalInput(formatLocal(begin)),
    expireAt: toLocalInput(formatLocal(end)),
    reason: '',
  }
}

function formatLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`
}

function confirmGrant() {
  if (!grantTarget.value) {
    return
  }
  const result = grantAuth({
    gateId: Number(grantTarget.value.id),
    toCrew: grantForm.value.toCrew,
    beginAt: `${grantForm.value.beginAt.replace('T', ' ')}:00`,
    expireAt: `${grantForm.value.expireAt.replace('T', ' ')}:00`,
    grantedBy: session.operator,
    reason: grantForm.value.reason,
    fromCrew: session.crewName,
  })
  grantTarget.value = null
  afterMutation(result)
}

function doRevoke(id: number) {
  afterMutation(revokeAuth(id, session.crewName))
}

// ---- 归属修改 ----
const ownTarget = ref<EntryRow | null>(null)
const ownForm = ref({ ownerCrew: '', scope: '' })
function openOwnership(row: EntryRow) {
  ownTarget.value = row
  ownForm.value = { ownerCrew: String(row.责任班组), scope: String(row.操作范围) }
}
function confirmOwnership() {
  if (!ownTarget.value) {
    return
  }
  const result = updateOwnership({
    gateId: Number(ownTarget.value.id),
    crew: session.crewName,
    operator: session.operator,
    ownerCrew: ownForm.value.ownerCrew,
    scope: ownForm.value.scope,
  })
  ownTarget.value = null
  afterMutation(result)
}

void nowText
onMounted(reload)
</script>
