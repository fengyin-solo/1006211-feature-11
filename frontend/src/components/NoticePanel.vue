<template>
  <section class="notice-panel" :class="{ compact }">
    <header class="notice-head">
      <div>
        <h3>提醒事项 / 待办清单</h3>
        <p class="notice-sub">各业务页面共用同一份清单，任意页面处理后此处同步更新 · 待办 {{ active.length }} 条</p>
      </div>
      <button v-if="active.length" class="btn ghost" type="button" @click="ackAll">全部知悉</button>
    </header>
    <ul v-if="active.length" class="notice-list">
      <li v-for="item in active" :key="item.id" class="notice-item" :class="`level-${item.level}`">
        <div class="notice-body">
          <strong>{{ item.title }}</strong>
          <span class="notice-detail">{{ item.detail }}</span>
          <span class="notice-meta">{{ item.module }} · {{ item.createdAt }}</span>
        </div>
        <div class="notice-tools">
          <RouterLink class="link" :to="item.path">去处理</RouterLink>
          <button class="link" type="button" @click="ack(item.id)">知悉</button>
        </div>
      </li>
    </ul>
    <p v-else class="notice-empty">暂无待办，各页面口径已对齐</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useNoticeStore } from '@/stores/notice'

const props = defineProps<{ compact?: boolean }>()
void props

const store = useNoticeStore()
const active = computed(() => store.activeNotices)

function ack(id: string) {
  store.acknowledge(id)
}

function ackAll() {
  store.acknowledgeAll()
}
</script>
