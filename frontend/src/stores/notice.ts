import { defineStore } from 'pinia'

import { getDomain, listRows } from '@/data/local-store'
import type { GateAuth, GateLedgerEntry, ReportItem } from '@/data/types'
import { canOperateGate } from '@/domain/gate-service'
import { nowMs, parseTime } from '@/domain/time'

// 提醒事项与待办清单：全局只算这一份，Dashboard / 闸门 / 泄洪 / 拦污栅页都引用同一个 store，
// 保证「提醒事项和待办清单要同步」。

export type Notice = {
  id: string
  level: 'warning' | 'danger' | 'info'
  title: string
  detail: string
  module: string
  path: string
  createdAt: string
}

const DONE_KEY = 'hydropower-plant-om:notice-done:v1'

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function readDone(): string[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  try {
    return JSON.parse(window.localStorage.getItem(DONE_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function writeDone(ids: string[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(DONE_KEY, JSON.stringify(ids))
  }
}

function push(list: Notice[], item: Notice): void {
  list.push(item)
}

export const useNoticeStore = defineStore('notice', {
  state: () => ({
    notices: [] as Notice[],
    doneIds: readDone(),
    version: 0,
  }),
  getters: {
    activeNotices(state): Notice[] {
      const done = new Set(state.doneIds)
      return state.notices.filter((item) => !done.has(item.id))
    },
    todoCount(): number {
      return this.activeNotices.length
    },
  },
  actions: {
    refresh(crew = '') {
      const list: Notice[] = []
      const gates = listRows('gate')
      const floods = listRows('flood')
      const racks = listRows('trashrack')

      // 1) 故障闸门
      for (const gate of gates.filter((row) => String(row.status) === '故障')) {
        push(list, {
          id: `gate-fault-${gate.id}`,
          level: 'danger',
          title: `故障闸门待处置：${String(gate.闸门编号)}`,
          detail: `责任班组：${String(gate.责任班组)}`,
          module: '闸门启闭',
          path: '/gate',
          createdAt: String(gate._updatedAt ?? gate.操作时间 ?? ''),
        })
      }

      // 2) 待清理拦污栅
      for (const rack of racks.filter((row) => String(row.status) === '待清理')) {
        push(list, {
          id: `rack-clean-${rack.id}`,
          level: 'warning',
          title: `拦污栅待清理：${String(rack.栅体编号)}`,
          detail: `关联闸门：${String(rack.关联闸门)}，前后压差：${String(rack.前后压差)}`,
          module: '拦污栅',
          path: '/trashrack',
          createdAt: String(rack._updatedAt ?? ''),
        })
      }

      // 3) 泄洪票待审批
      for (const flood of floods.filter((row) => String(row.status) === '待审批')) {
        push(list, {
          id: `flood-approve-${flood.id}`,
          level: 'warning',
          title: `泄洪操作待审批：${String(flood.操作编号)}`,
          detail: `${String(flood.泄洪闸号)}，仅责任班组${String(flood.责任班组)}可提交审批`,
          module: '泄洪操作',
          path: '/flood',
          createdAt: String(flood.操作时间 ?? ''),
        })
      }

      // 4) 越权/冲突类拦截（最近 24 小时）
      const domain = getDomain()
      const ledger = domain.gateLedger as unknown as GateLedgerEntry[]
      for (const entry of ledger
        .filter((row) => row.result === 'rejected')
        .filter((row) => row.rejectCode === 'OWNERSHIP' || row.rejectCode === 'AUTH_EXPIRED' || row.rejectCode === 'SCOPE')
        .filter((row) => nowMs() - parseTime(row.operatedAt) <= 24 * 3600 * 1000)) {
        const reason = entry.note ?? ''
        push(list, {
          id: `gate-reject-${entry.id}`,
          level: entry.rejectCode === 'AUTH_EXPIRED' ? 'info' : 'danger',
          title: `${entry.gateNo} 越权操作已挡回`,
          detail: `${entry.operatorCrew}${entry.operator} 发起「${entry.action}」：${reason}`,
          module: '闸门启闭',
          path: '/gate',
          createdAt: entry.operatedAt,
        })
      }

      // 5) 即将到期（4 小时内）的临时授权
      const auths = domain.gateAuth as unknown as GateAuth[]
      for (const auth of auths.filter((item) => !item.revoked)) {
        const left = parseTime(auth.expireAt) - nowMs()
        if (left > 0 && left <= 4 * 3600 * 1000) {
          push(list, {
            id: `auth-expire-${auth.id}`,
            level: 'info',
            title: `临时授权即将到期：${auth.toCrew}`,
            detail: `闸门操作权将于 ${auth.expireAt} 自动收回`,
            module: '闸门启闭',
            path: '/gate',
            createdAt: nowText(),
          })
        }
      }

      // 6) 缺失字段待补录
      for (const report of (domain.reports as unknown as ReportItem[]).filter((row) => row.kind === 'missing')) {
        push(list, {
          id: report.id,
          level: 'info',
          title: `${report.module}缺项待补：${report.target}`,
          detail: report.detail,
          module: report.module,
          path: '/gate',
          createdAt: report.happenedAt,
        })
      }

      // 7) 当前班组有操作权但闸门处于待操作状态（只读班组不产生个人待办）
      if (crew) {
        for (const gate of gates.filter((row) => String(row.status) === '待操作')) {
          const permission = canOperateGate(gate, crew)
          if (permission.allowed) {
            const prefix = permission.viaAuth ? '借权期间' : ''
            push(list, {
              id: `gate-pending-${gate.id}`,
              level: 'info',
              title: `闸门待操作：${String(gate.闸门编号)}`,
              detail: `${prefix}归属${String(gate.责任班组)}，操作范围：${String(gate.操作范围)}`,
              module: '闸门启闭',
              path: '/gate',
              createdAt: String(gate._updatedAt ?? ''),
            })
          }
        }
      }

      list.sort((a, b) => parseTime(b.createdAt) - parseTime(a.createdAt))
      this.notices = list
      this.version += 1
    },
    acknowledge(id: string) {
      if (!this.doneIds.includes(id)) {
        this.doneIds = [...this.doneIds, id]
        writeDone(this.doneIds)
      }
    },
    acknowledgeAll() {
      const merged = new Set([...this.doneIds, ...this.notices.map((item) => item.id)])
      this.doneIds = [...merged]
      writeDone(this.doneIds)
    },
  },
})
