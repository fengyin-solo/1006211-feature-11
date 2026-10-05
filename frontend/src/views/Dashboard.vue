<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标；提醒事项与待办清单与闸门、泄洪、拦污栅页面实时同步。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
        <button class="btn ghost" type="button" @click="resetDemo">重置演示数据并重跑历史对齐</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <div class="notice-grid">
      <section class="notice-panel">
        <h3>自动提醒（{{ notice.reminders.length }}）<span class="panel-sub">跨页同一份</span></h3>
        <ul class="notice-list">
          <li v-for="item in notice.reminders" :key="item.key">
            <span class="notice-dot" />
            <div>
              <div>{{ item.事项 }}</div>
              <div class="cell-sub">{{ item.来源 }} · {{ item.关联编号 }}<template v-if="item.责任班组"> · {{ crewName(item.责任班组) }}</template></div>
            </div>
          </li>
          <li v-if="!notice.reminders.length" class="empty-inline">暂无提醒</li>
        </ul>
      </section>
      <section class="notice-panel">
        <h3>待办清单（{{ notice.openTodos.length }}）<span class="panel-sub">与各页面同步</span></h3>
        <ul class="notice-list">
          <li v-for="todo in notice.openTodos" :key="todo.id">
            <span class="notice-dot todo" />
            <div class="todo-line">
              <div>{{ todo.事项 }}</div>
              <div class="cell-sub">{{ todo.来源 }} · {{ todo.关联编号 }} · {{ crewName(todo.责任班组) }}</div>
              <button class="link" type="button" @click="complete(todo.id)">完成</button>
            </div>
          </li>
          <li v-if="!notice.openTodos.length" class="empty-inline">暂无待办</li>
        </ul>
      </section>
    </div>

    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>登记总量</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里；历史补数、取值对齐在首次加载时自动完成</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { resetAllAndBootstrap } from '@/domain/bootstrap'
import { crewName } from '@/domain/identity'
import { loadOverview } from '@/api/local-service'
import { useNoticeStore } from '@/stores/notice'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const notice = useNoticeStore()

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  notice.refresh()
}

function complete(id: number) {
  notice.completeTodo(id)
}

function resetDemo() {
  resetAllAndBootstrap()
  refresh()
}

onMounted(refresh)
</script>

<style scoped>
.notice-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 14px;
}
.notice-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 14px;
}
.notice-panel h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
.panel-sub {
  font-size: 11px;
  color: var(--muted);
  font-weight: normal;
  margin-left: 6px;
}
.notice-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 280px;
  overflow: auto;
}
.notice-list li {
  display: flex;
  gap: 8px;
  font-size: 13px;
}
.notice-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f79009;
  margin-top: 6px;
  flex: none;
}
.notice-dot.todo { background: var(--brand); }
.cell-sub { color: var(--muted); font-size: 11px; }
.empty-inline { color: var(--muted); }
.todo-line .link { font-size: 12px; }
</style>
