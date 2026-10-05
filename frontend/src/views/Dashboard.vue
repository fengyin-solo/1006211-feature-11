<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标；闸门孔数、清污条数跨页同源，提醒待办全平台同一份。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <div class="stat-row">
      <article class="stat-card"><span class="stat-label">闸门当前开启孔数（泄洪同口径）</span><strong class="stat-value">{{ openHoles }}</strong></article>
      <article class="stat-card"><span class="stat-label">清污台账总条数（两页一致）</span><strong class="stat-value">{{ cleanTotal }}</strong></article>
      <article class="stat-card"><span class="stat-label">有效临时授权</span><strong class="stat-value">{{ activeAuth }}</strong></article>
      <article class="stat-card"><span class="stat-label">待补缺失字段</span><strong class="stat-value">{{ missingCount }}</strong></article>
    </div>

    <NoticePanel />

    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>登记量</th><th>待处理</th><th>异常量</th></tr>
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
      <span>数据保存在本机浏览器里；历史数据已按业务日期补数，争议取值以较晚产生的为准并统一</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import type { OverviewResult } from '@/data/types'
import NoticePanel from '@/components/NoticePanel.vue'
import { useNoticeStore } from '@/stores/notice'
import { useSessionStore } from '@/stores/session'
import { listAuths, listCleanLedger, listReports, totalOpenHoles } from '@/domain/gate-service'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const openHoles = ref(0)
const cleanTotal = ref(0)
const activeAuth = ref(0)
const missingCount = ref(0)

const notice = useNoticeStore()
const session = useSessionStore()

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  openHoles.value = totalOpenHoles()
  cleanTotal.value = listCleanLedger().length
  activeAuth.value = listAuths().filter((item) => item.active).length
  missingCount.value = listReports().filter((item) => item.kind === 'missing').length
  notice.refresh(session.crewName)
}

onMounted(refresh)
</script>
