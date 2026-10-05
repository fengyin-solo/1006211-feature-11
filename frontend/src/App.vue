<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">水电站机组运行检修管理平台</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
          <span v-if="notice.openCount && item.path === '/gate'" class="nav-badge">{{ notice.openCount }}</span>
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">闸门归属到班组、调班临时授权、启闭孔数与泄洪/清污跨页对齐。</span>
        <span class="head-user">
          <label class="actor-switch">
            值班身份
            <select :value="session.actor.name" @change="switchActor(($event.target as HTMLSelectElement).value)">
              <option v-for="actor in session.actorOptions" :key="actor.name" :value="actor.name">
                {{ actor.name }} · {{ actor.role }}
              </option>
            </select>
          </label>
          <RouterLink to="/gate" class="notice-link">
            提醒/待办
            <span v-if="notice.openCount" class="notice-badge">{{ notice.openCount }}</span>
          </RouterLink>
          <span>{{ store.shiftLabel }}</span>
        </span>
      </header>
      <RouterView v-slot="{ Component }">
        <component :is="Component" @changed="notice.refresh" />
      </RouterView>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, watch } from 'vue'

import { bootstrapDomain } from '@/domain/bootstrap'
import { ACTORS } from '@/domain/identity'
import { useNoticeStore } from '@/stores/notice'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const session = useSessionStore()
const notice = useNoticeStore()

const navItems = [
  { label: '运营概览', path: '/' },
  { label: '电站台账', path: '/station' },
  { label: '机组运行', path: '/unit' },
  { label: '调速器', path: '/governor' },
  { label: '励磁系统', path: '/excitation' },
  { label: '主变压器', path: '/transformer' },
  { label: '闸门启闭', path: '/gate' },
  { label: '渗流监测', path: '/seepage' },
  { label: '位移监测', path: '/displacement' },
  { label: '拦污栅', path: '/trashrack' },
  { label: '机组检修', path: '/overhaul' },
  { label: '导轴承', path: '/bearing' },
  { label: '技术供水', path: '/cooling' },
  { label: '水情调度', path: '/hydrology' },
  { label: '泄洪操作', path: '/flood' },
  { label: '发电计划', path: '/generation' },
  { label: '继电保护', path: '/protection' },
  { label: '缺陷处置', path: '/defect' },
  { label: '检修人员', path: '/crew' },
  { label: '备品备件', path: '/spare' },
]

function switchActor(name: string): void {
  const actor = ACTORS.find((item) => item.name === name)
  if (actor) {
    session.setActor(actor)
    notice.refresh()
  }
}

watch(
  () => session.actor.crewCode,
  () => notice.refresh(),
)

onMounted(() => {
  bootstrapDomain()
  notice.refresh()
})
</script>

<style scoped>
.actor-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.actor-switch select {
  font: inherit;
  padding: 2px 6px;
  border-radius: 6px;
  border: 1px solid var(--border);
}
.notice-link {
  color: var(--brand);
  text-decoration: none;
  position: relative;
}
.notice-badge,
.nav-badge {
  background: #d92d20;
  color: #fff;
  border-radius: 999px;
  font-size: 11px;
  padding: 0 6px;
  margin-left: 4px;
}
.nav-badge {
  background: #f79009;
}
.head-user {
  display: inline-flex;
  gap: 14px;
  align-items: center;
}
</style>
