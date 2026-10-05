<template>
  <section class="page" data-module="trashrack">
    <NoticePanel compact />

    <header class="page-head">
      <div>
        <h2>拦污栅管理</h2>
        <p class="page-desc">
          清污条数以共享清污台账为准：本页与闸门启闭页读到的是同一个数，重复清污提交同一时段只保留一笔。历史无清理人的按清污责任班组补记。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出拦污栅清单</button>
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
      <span class="legend-item">清污台账总条数：{{ totalClean }}</span>
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
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '清污次数'">
              <strong>{{ liveCount(row) }}</strong>
              <span v-if="Number(row[column]) !== liveCount(row)" class="badge blocked">原记{{ row[column] }}，已按台账统一</span>
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="genericAction('安排清理', row)">安排清理</button>
            <button class="link" type="button" @click="confirmClean(row)">确认完成（记清污台账）</button>
            <button class="link" type="button" @click="genericAction('登记损坏', row)">登记损坏</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无拦污栅数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条拦污栅记录 · 台账 {{ totalClean }} 条清污记录</span>
      <span v-if="message" class="error-text">{{ message }}</span>
    </footer>

    <section class="sub-panel">
      <h3>清污台账（与闸门台账同源，跨页清污条数相同）</h3>
      <table class="data-table">
        <thead>
          <tr><th>清理时间</th><th>栅体编号</th><th>关联闸门</th><th>清理人</th><th>班组</th><th>备注</th></tr>
        </thead>
        <tbody>
          <tr v-for="entry in cleanLedger" :key="entry.id">
            <td>{{ entry.cleanedAt }}</td>
            <td>{{ entry.rackNo }}</td>
            <td>{{ entry.gateNo || '—' }}</td>
            <td>{{ entry.operator }}</td>
            <td>{{ entry.crew }}</td>
            <td>{{ entry.note ?? (entry.source === 'history-backfill' ? '历史回填' : '') }}</td>
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
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'
import { useNoticeStore } from '@/stores/notice'
import NoticePanel from '@/components/NoticePanel.vue'
import { cleanCountByRack, listCleanLedger, recordCleaning } from '@/domain/gate-service'

const meta = moduleMeta('trashrack')
const session = useSessionStore()
const notice = useNoticeStore()

const columns = ['栅体编号', '所属机组', '前后压差', '清污次数', '清污方式', '关联闸门', '清理日期', '清理人员']
const statuses = ['待清理', '清理中', '已清理', '已损坏']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const message = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const cleanLedger = ref(listCleanLedger())
const counts = ref<Record<number, number>>({})

const totalClean = computed(() => cleanLedger.value.length)
const stats = computed(() => [
  { label: '待清理栅体', value: rows.value.filter((row) => String(row.status) === '待清理').length },
  { label: '已清理栅体', value: rows.value.filter((row) => String(row.status) === '已清理').length },
  { label: '累计清污条数', value: totalClean.value },
  { label: '最大压差', value: rows.value.reduce((max, row) => Math.max(max, Number(String(row.前后压差).replace('m', '')) || 0), 0).toFixed(1) + 'm' },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function liveCount(row: EntryRow): number {
  return counts.value[Number(row.id)] ?? Number(row.清污次数) ?? 0
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function genericAction(action: string, row: EntryRow) {
  const result = applyAction(meta.key, Number(row.id), action)
  message.value = result.message
  reload()
  notice.refresh(session.crewName)
}

function confirmClean(row: EntryRow) {
  const result = recordCleaning({ rackId: Number(row.id), operator: session.operator, crew: session.crewName })
  message.value = result.message
  reload()
  notice.refresh(session.crewName)
}

function reload() {
  message.value = ''
  const payload = listEntries(meta.key, filters.value)
  rows.value = payload.items
  total.value = payload.total
  cleanLedger.value = listCleanLedger()
  counts.value = cleanCountByRack()
}

onMounted(reload)
</script>
