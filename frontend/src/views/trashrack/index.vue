<template>
  <section class="page" data-module="trashrack">
    <header class="page-head">
      <div>
        <h2>拦污栅管理</h2>
        <p class="page-desc">清污结果与闸门页同一口径：跨页清污条数相同；两套取值有争议时以较晚产生的一套为准并统一。</p>
      </div>
    </header>

    <div class="rule-banner">
      当前身份：<strong>{{ session.actor.name }}（{{ crewName(session.actor.crewCode) }} · {{ session.actor.role }}）</strong>
      ｜观测岗只读；运行岗、检修岗可安排清理/确认完成。台账合计自动同步闸门页清污口径。
    </div>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待清理</span>
        <strong class="stat-value">{{ stats.todo }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已清理</span>
        <strong class="stat-value">{{ stats.done }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">台账清污合计</span>
        <strong class="stat-value">{{ ledgerTotal }} 条</strong>
      </article>
      <article class="stat-card highlight">
        <span class="stat-label">跨页统一清污条数（闸门页相同）</span>
        <strong class="stat-value">{{ canonicalTotal }} 条</strong>
      </article>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>栅体编号</th>
          <th>所属机组</th>
          <th>前后压差(m)</th>
          <th>清污次数</th>
          <th>清污方式</th>
          <th>清理日期</th>
          <th>清理人员</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td>{{ row.栅体编号 }}</td>
          <td>{{ row.所属机组 }}</td>
          <td>{{ row.前后压差 }}</td>
          <td>{{ row.清污次数 }}</td>
          <td>{{ row.清污方式 || '—' }}</td>
          <td>{{ row.清理日期 }}</td>
          <td>{{ row.清理人员 || '—' }}</td>
          <td><span :class="['status-pill', rackStatusClass(row.栅体状态)]">{{ row.栅体状态 }}</span></td>
          <td class="row-actions">
            <template v-if="session.isReadonly">
              <span class="muted-link">只读</span>
            </template>
            <template v-else>
              <button v-if="row.栅体状态 === '待清理'" class="link" type="button" @click="call(() => scheduleCleaning(row.id, session.actor))">安排清理</button>
              <button v-if="row.栅体状态 === '清理中'" class="link" type="button" @click="openComplete(row)">确认完成</button>
              <button class="link" type="button" @click="call(() => reportRackDamage(row.id, session.actor))">登记损坏</button>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="9" class="empty-state">暂无拦污栅数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 台拦污栅</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <Modal :open="completeModal" title="确认清污完成" @close="completeModal = false">
      <div class="form-row">
        <label>栅体</label>
        <div>{{ activeRow?.栅体编号 }}（{{ activeRow?.所属机组 }}）</div>
      </div>
      <div class="form-row">
        <label>本次清污条数</label>
        <input v-model.number="cleanCount" type="number" min="1" step="1" />
      </div>
      <div class="form-row">
        <label>清污方式</label>
        <input v-model="cleanWay" placeholder="清污机抓取 / 人工配合" />
      </div>
      <template #footer>
        <button class="btn" type="button" @click="completeModal = false">取消</button>
        <button class="btn primary" type="button" @click="confirmComplete">确认并同步两页条数</button>
      </template>
    </Modal>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import Modal from '@/components/Modal.vue'
import {
  canonicalCleaningTotal,
  completeCleaning,
  ledgerCleaningTotal,
  listRacks,
  reportRackDamage,
  scheduleCleaning,
} from '@/domain/trashrack-service'
import { crewName } from '@/domain/identity'
import { useNoticeStore } from '@/stores/notice'
import { useSessionStore } from '@/stores/session'
import type { ActionResult, TrashrackRow } from '@/domain/types'

const session = useSessionStore()
const notice = useNoticeStore()

const rows = ref<TrashrackRow[]>([])
const message = ref('')
const messageOk = ref(false)
const completeModal = ref(false)
const activeRow = ref<TrashrackRow | null>(null)
const cleanCount = ref(1)
const cleanWay = ref('清污机抓取')

const ledgerTotal = ref(0)
const canonicalTotal = ref(0)

const stats = computed(() => ({
  todo: rows.value.filter((row) => row.栅体状态 === '待清理' || row.栅体状态 === '清理中').length,
  done: rows.value.filter((row) => row.栅体状态 === '已清理').length,
}))

function rackStatusClass(status: string): string {
  if (status === '已清理') return 'pill-open'
  if (status === '已损坏') return 'pill-fault'
  return 'pill-warn'
}

function openComplete(row: TrashrackRow): void {
  activeRow.value = row
  cleanCount.value = 1
  cleanWay.value = '清污机抓取'
  completeModal.value = true
}
function confirmComplete(): void {
  if (!activeRow.value) return
  completeModal.value = false
  call(() =>
    completeCleaning(activeRow.value!.id, session.actor, {
      清污方式: cleanWay.value,
      条数: cleanCount.value,
    }),
  )
}

function call(fn: () => ActionResult): void {
  const result = fn()
  message.value = result.message
  messageOk.value = result.ok
  reload()
  notice.refresh()
}

function reload(): void {
  rows.value = listRacks()
  ledgerTotal.value = ledgerCleaningTotal()
  canonicalTotal.value = canonicalCleaningTotal()
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
.stat-card.highlight { border-color: #1f6feb; background: #f3f8ff; }
.status-pill { border-radius: 999px; padding: 2px 10px; font-size: 12px; }
.pill-open { background: #e3f9ec; color: #067647; }
.pill-warn { background: #fff4e0; color: #9a5b00; }
.pill-fault { background: #fdecec; color: #b42318; }
.muted-link { color: var(--muted); font-size: 12px; }
.ok-text { color: #067647; }
.form-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.form-row label { font-size: 12px; color: var(--muted); }
.form-row input { border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font: inherit; }
</style>
