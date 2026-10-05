<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">水电站机组运行检修管理平台</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">闸门归属到班组：只有责任班组与持有效临时授权者能启闭自己的闸门；闸孔开度与泄洪孔数同口径。</span>
        <span class="head-user">
          <label>
            当前值班
            <select :value="store.operator" @change="onSwitch(($event.target as HTMLSelectElement).value)">
              <option v-for="person in operators" :key="person.name" :value="person.name">
                {{ person.name }}（{{ crewName(person.crew) }}·{{ postName(person.crew) }}）
              </option>
            </select>
          </label>
          <span class="badge owner">{{ store.crewName }}</span>
          <span class="muted">待办 {{ notice.todoCount }}</span>
        </span>
      </header>
      <RouterView @changed="refresh" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'

import { useSessionStore } from '@/stores/session'
import { useNoticeStore } from '@/stores/notice'
import { OPERATORS, CREWS, type CrewKey } from '@/domain/constants'

const store = useSessionStore()
const notice = useNoticeStore()
const operators = OPERATORS

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

function crewName(key: CrewKey): string {
  return CREWS[key].name
}

function postName(key: CrewKey): string {
  return CREWS[key].post
}

function onSwitch(name: string) {
  store.setOperator(name)
  refresh()
}

function refresh() {
  notice.refresh(store.crewName)
}

onMounted(refresh)
</script>
