<template>
  <section class="page" data-module="flood">
    <header class="page-head">
      <div>
        <h2>泄洪操作管理</h2>
        <p class="page-desc">开启孔数与闸门页闸孔实测同源：两套取值并存时以较晚产生的为准并统一，两页读到的孔数始终一致。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="showSync = true">取值对齐日志</button>
      </div>
    </header>

    <div class="rule-banner">
      当前身份：<strong>{{ session.actor.name }}（{{ crewName(session.actor.crewCode) }} · {{ session.actor.role }}）</strong>
      ｜提交审批、开启/结束泄洪只允许闸段责任班组；其他岗位只读。
    </div>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待审批</span>
        <strong class="stat-value">{{ stats.pending }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">泄洪中操作</span>
        <strong class="stat-value">{{ stats.running }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">统一开启孔数（=闸门实测）</span>
        <strong class="stat-value">{{ stats.holes }} 孔</strong>
      </article>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>操作编号</th>
          <th>泄洪闸号</th>
          <th>开启孔数（统一口径）</th>
          <th>闸孔实测</th>
          <th>泄洪流量(m³/s)</th>
          <th>下游预警</th>
          <th>责任班组</th>
          <th>操作人员/时间</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td>{{ row.操作编号 }}</td>
          <td>{{ row.泄洪闸号 }}</td>
          <td>
            <strong>{{ row.开启孔数 }}</strong>
            <div class="cell-sub">{{ row.孔数来源 }}</div>
          </td>
          <td>{{ physicalOf(row.泄洪闸号) }} 孔</td>
          <td>{{ row.泄洪流量 }}</td>
          <td>{{ row.下游预警 }}</td>
          <td>{{ crewName(ownerOf(row.泄洪闸号)) }}</td>
          <td>
            <div>{{ row.操作人员 }}</div>
            <div class="cell-sub">{{ row.操作时间 }}</div>
          </td>
          <td><span :class="['status-pill', floodStatusClass(row.操作状态)]">{{ row.操作状态 }}</span></td>
          <td class="row-actions">
            <template v-if="session.isReadonly">
              <span class="muted-link">只读</span>
            </template>
            <template v-else>
              <button v-if="row.操作状态 === '待审批'" class="link" type="button" @click="call(() => submitFloodApproval(row.id, session.actor))">提交审批</button>
              <button v-if="row.操作状态 === '已批准'" class="link" type="button" @click="askStart(row)">开启泄洪</button>
              <button v-if="row.操作状态 === '泄洪中'" class="link" type="button" @click="call(() => finishFlood(row.id, session.actor))">结束泄洪</button>
              <span v-if="!availableAction(row)" class="muted-link">—</span>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="10" class="empty-state">暂无泄洪操作</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 条泄洪操作；孔数以统一口径为准，与闸门启闭页一致</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <Modal :open="startModal" title="开启泄洪（登记开启孔数）" @close="startModal = false">
      <div class="form-row">
        <label>操作 / 闸段</label>
        <div>{{ activeRow?.操作编号 }} · {{ activeRow?.泄洪闸号 }}（责任班组：{{ activeRow ? crewName(ownerOf(activeRow.泄洪闸号)) : '' }}）</div>
      </div>
      <div class="form-row">
        <label>本次开启孔数（晚于闸门实测时以本登记为准，并逐孔对齐闸孔）</label>
        <input v-model.number="startHoles" type="number" min="0" :max="gateCountOf(activeRow?.泄洪闸号 ?? '')" />
        <span class="cell-sub">该闸段共有 {{ gateCountOf(activeRow?.泄洪闸号 ?? '') }} 扇工作闸门</span>
      </div>
      <template #footer>
        <button class="btn" type="button" @click="startModal = false">取消</button>
        <button class="btn primary" type="button" @click="confirmStart">确认开启</button>
      </template>
    </Modal>

    <Modal :open="showSync" title="跨页取值对齐日志（较晚一套为准）" @close="showSync = false">
      <table class="data-table inner-table">
        <thead>
          <tr><th>业务</th><th>对齐结果</th><th>保留/落选</th><th>依据</th><th>处理时间</th></tr>
        </thead>
        <tbody>
          <tr v-for="log in syncLogs" :key="log.id">
            <td>{{ log.业务 }}</td>
            <td>{{ log.对齐结果 }}</td>
            <td>{{ log.保留值 }} / {{ log.落选值 }}</td>
            <td class="cell-sub">{{ log.依据 }}</td>
            <td>{{ fmt(log.处理时间) }}</td>
          </tr>
        </tbody>
      </table>
    </Modal>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import Modal from '@/components/Modal.vue'
import { listRows } from '@/data/local-store'
import {
  finishFlood,
  listFloods,
  startFlood,
  submitFloodApproval,
  bayOwner,
} from '@/domain/flood-service'
import { listSyncLogs } from '@/domain/queries'
import { crewName } from '@/domain/identity'
import { useNoticeStore } from '@/stores/notice'
import { useSessionStore } from '@/stores/session'
import type { ActionResult, FloodRow, GateRow, SyncLogRow } from '@/domain/types'

const session = useSessionStore()
const notice = useNoticeStore()

const rows = ref<FloodRow[]>([])
const gates = ref<GateRow[]>([])
const syncLogs = ref<SyncLogRow[]>([])
const message = ref('')
const messageOk = ref(false)
const startModal = ref(false)
const showSync = ref(false)
const activeRow = ref<FloodRow | null>(null)
const startHoles = ref(1)

function ownerOf(bay: string): string {
  return bayOwner(bay) ?? ''
}
function physicalOf(bay: string): number {
  return gates.value.filter((gate) => gate.参与泄洪 && gate.闸段 === bay && gate.当前开度 > 0).length
}
function gateCountOf(bay: string): number {
  return gates.value.filter((gate) => gate.参与泄洪 && gate.闸段 === bay).length
}

const stats = computed(() => ({
  pending: rows.value.filter((row) => row.操作状态 === '待审批').length,
  running: rows.value.filter((row) => row.操作状态 === '泄洪中').length,
  holes: gates.value.filter((gate) => gate.参与泄洪 && gate.当前开度 > 0).length,
}))

function floodStatusClass(status: string): string {
  if (status === '泄洪中') return 'pill-open'
  if (status === '待审批') return 'pill-warn'
  return 'pill-closed'
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

function availableAction(row: FloodRow): boolean {
  return ['待审批', '已批准', '泄洪中'].includes(row.操作状态)
}

function askStart(row: FloodRow): void {
  activeRow.value = row
  startHoles.value = gateCountOf(row.泄洪闸号)
  startModal.value = true
}
function confirmStart(): void {
  if (!activeRow.value) return
  startModal.value = false
  call(() => startFlood(activeRow.value!.id, session.actor, startHoles.value))
}

function call(fn: () => ActionResult): void {
  const result = fn()
  message.value = result.message
  messageOk.value = result.ok
  reload()
  notice.refresh()
}

function reload(): void {
  rows.value = listFloods()
  gates.value = listRows('gate') as unknown as GateRow[]
  syncLogs.value = listSyncLogs()
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
.status-pill { border-radius: 999px; padding: 2px 10px; font-size: 12px; }
.pill-open { background: #e3f9ec; color: #067647; }
.pill-warn { background: #fff4e0; color: #9a5b00; }
.pill-closed { background: #eef2f7; color: #475569; }
.cell-sub { color: var(--muted); font-size: 11px; }
.muted-link { color: var(--muted); font-size: 12px; }
.inner-table { font-size: 12px; }
.inner-table th, .inner-table td { padding: 6px 8px; }
.ok-text { color: #067647; }
.form-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.form-row label { font-size: 12px; color: var(--muted); }
.form-row input { border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font: inherit; }
</style>
