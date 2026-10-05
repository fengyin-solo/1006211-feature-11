import { defineStore } from 'pinia'
import { ACTORS, DEFAULT_ACTOR } from '@/domain/identity'
import type { Actor } from '@/domain/types'

// 当前值班身份：顶栏可切换班组，用来演示本班组放行、越权拒绝。
export const useSessionStore = defineStore('session', {
  state: () => ({
    actor: { ...DEFAULT_ACTOR } as Actor,
    shiftLabel: '白班 08:00-20:00',
    scope: '水电站机组运行检修管理平台',
  }),
  getters: {
    operator: (state) => state.actor.name,
    canOperate: (state) => state.actor.name.length > 0,
    isReadonly: (state) => state.actor.role === '观测岗',
    actorOptions: () => ACTORS,
  },
  actions: {
    setActor(actor: Actor) {
      this.actor = { ...actor }
    },
    setShift(label: string) {
      this.shiftLabel = label
    },
  },
})
