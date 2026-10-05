<template>
  <section class="page" data-module="flood">
    <NoticePanel compact />

    <header class="page-head">
      <div>
        <h2>泄洪操作管理</h2>
        <p class="page-desc">
          开启孔数直接读闸门当前开度：每扇开度 &gt; 0 的闸门计 1 孔，与闸门页完全同源，闸门开着这里绝不会算关闭。提交审批、开启/结束泄洪仅闸组责任班组可操作。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出泄洪操作清单</button>
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
    </p>

    <p class="readonly-hint">
      当前值班：<strong>{{ session.operator }}</strong>（{{ session.crewName }}）。
      闸门口径实时同步：<strong v-for="(holes, group) in holeGroups" :key="group">{{ group }} {{ holes }}孔；</strong>
      非责任班组只能查看。
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
          <th>我的权限</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '开启孔数'">
              <strong>{{ liveHoles(row) }}</strong>
              <span v-if="Number(row[column]) !== liveHoles(row)" class="badge blocked">原记{{ row[column] }}，已按闸门口径统一</span>
            </template>
            <template v-else-if="column === '责任班组'"><span class="badge owner">{{ row[column] }}</span></template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>
            {{ liveStatus(row) }}
            <span v-if="String(row.status) !== liveStatus(row)" class="badge blocked">原「{{ row.status }}」已对齐</span>
          </td>
          <td>
            <span v-if="String(row.责任班组) === session.crewName" class="badge owner">本班组可操作</span>
            <span v-else class="badge readonly">只读</span>
          </td>
          <td class="row-actions">
            <template v-if="String(row.责任班组) === session.crewName">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else class="muted">仅{{ row.责任班组 }}可{{ (actions as string[]).join('/') }}</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无泄洪操作数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条泄洪操作票</span>
      <span v-if="message" class="error-text">{{ message }}</span>
    </footer>
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
import { listFlood, operateFlood, openHolesSnapshot } from '@/domain/flood-service'

const meta = moduleMeta('flood')
const session = useSessionStore()
const notice = useNoticeStore()

const columns = ['操作编号', '泄洪闸号', '开启孔数', '泄洪流量', '下游预警', '责任班组', '操作时间', '操作人员']
const actions = ['提交审批', '开启泄洪', '结束泄洪']
const statuses = ['待审批', '已批准', '泄洪中', '已结束']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const message = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['操作编号', '泄洪闸号', '责任班组']
const holeGroups = ref<Record<string, number>>({})

const stats = computed(() => [
  { label: '待审批操作', value: rows.value.filter((row) => String(row.status) === '待审批').length },
  { label: '泄洪中闸组', value: Object.values(holeGroups.value).filter((v) => v > 0).length },
  { label: '当前开启孔数', value: Object.values(holeGroups.value).reduce((a, b) => a + b, 0) },
  { label: '今日泄洪量', value: rows.value.reduce((sum, row) => sum + (Number(row.泄洪流量) || 0), 0) },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => liveStatus(row) === status).length,
  })),
)

function liveHoles(row: EntryRow): number {
  // 已结束的历史票保持存档孔数；实时孔数口径只作用于未终结的当前票。
  if (String(row.status) === '已结束') {
    return Number(row.开启孔数) || 0
  }
  return holeGroups.value[String(row.泄洪闸号)] ?? 0
}

function liveStatus(row: EntryRow): string {
  if (String(row.status) === '已结束') {
    return String(row.status)
  }
  return liveHoles(row) > 0 ? '泄洪中' : String(row.status) === '待审批' ? '待审批' : '已批准'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  message.value = ''
  const result = operateFlood({ id: Number(row.id), action, operator: session.operator, crew: session.crewName })
  message.value = result.message
  reload()
  notice.refresh(session.crewName)
}

function reload() {
  message.value = ''
  holeGroups.value = openHolesSnapshot()
  const payload = listEntries(meta.key, filters.value)
  rows.value = listFlood().filter((row) =>
    Object.entries(filters.value).every(([field, value]) =>
      value.trim() === '' || String(row[field] ?? '').includes(value.trim()),
    ),
  )
  total.value = payload.total
}

onMounted(reload)
</script>
