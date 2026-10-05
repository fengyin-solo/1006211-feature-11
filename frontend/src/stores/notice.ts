import { defineStore } from 'pinia'
import { listRows, listTable, nextId, saveTable } from '@/data/local-store'
import { businessDate, nowIso } from '@/data/clock'
import { crewName } from '@/domain/identity'
import { activeGrant } from '@/domain/ownership'
import { canonicalCleaningTotal } from '@/domain/trashrack-service'
import type { FloodRow, GateRow, GrantRow, TodoRow, TrashrackRow } from '@/domain/types'

// 提醒事项与待办清单：闸门页、泄洪页、拦污栅页、概览页读的都是这一份，跨页同步。
// 自动提醒由当前台账实时派生（归属/授权/孔数/清污口径变了，提醒立刻变）；
// 人工待办持久化在 todos 表里。

const TODO_TABLE = 'todos'

type Reminder = {
  key: string
  事项: string
  来源: string
  关联编号: string
  责任班组: string
}

export const useNoticeStore = defineStore('notice', {
  state: () => ({
    manual: [] as TodoRow[],
    reminders: [] as Reminder[],
    version: 0,
  }),
  getters: {
    openTodos(state): TodoRow[] {
      return state.manual.filter((row) => row.状态 === '待办')
    },
    openCount(): number {
      return this.openTodos.length + this.reminders.length
    },
  },
  actions: {
    /** 重新从各台账派生提醒并载入待办；任何页面做完写操作后调一次，跨页立即同步。 */
    refresh() {
      const reminders: Reminder[] = []

      // 1) 故障闸门：责任班组处理。
      const gates = listRows('gate') as unknown as GateRow[]
      for (const gate of gates) {
        if (gate.闸门状态 === '故障' || gate.status === '故障') {
          reminders.push({
            key: `gate-fault-${gate.id}`,
            事项: `闸门 ${gate.闸门编号}（${gate.闸段}）已登记故障，待${crewName(gate.责任班组)}处置`,
            来源: '闸门启闭',
            关联编号: gate.闸门编号,
            责任班组: gate.责任班组,
          })
        }
        if (gate.孔口尺寸 === '待补录') {
          reminders.push({
            key: `gate-missing-${gate.id}`,
            事项: `闸门 ${gate.闸门编号} 孔口尺寸历史缺项待责任班组补登记`,
            来源: '缺项清单',
            关联编号: gate.闸门编号,
            责任班组: gate.责任班组,
          })
        }
        const grant = activeGrant(gate.id)
        if (grant) {
          const remainMs = new Date(grant.授权到期).getTime() - Date.now()
          const near = remainMs <= 24 * 3600 * 1000
          reminders.push({
            key: `grant-${grant.id}`,
            事项: `闸门 ${gate.闸门编号} 由${crewName(grant.借用班组)}借用操作权，${new Date(grant.授权到期).toLocaleString('zh-CN', { hour12: false })}到期自动收回${near ? '（临期）' : ''}；期间操作记录仍归${crewName(grant.原班组)}`,
            来源: '临时授权',
            关联编号: grant.闸门编号,
            责任班组: grant.原班组,
          })
        }
      }

      // 2) 泄洪待审批/泄洪中：归闸段责任班组。
      const floods = listRows('flood') as unknown as FloodRow[]
      for (const flood of floods) {
        const owner = gates.find((gate) => gate.参与泄洪 && gate.闸段 === flood.泄洪闸号)?.责任班组 ?? ''
        if (flood.操作状态 === '待审批') {
          reminders.push({
            key: `flood-approve-${flood.id}`,
            事项: `${flood.操作编号} 泄洪审批待${crewName(owner)}提交：${flood.泄洪闸号} 申报 ${flood.开启孔数} 孔`,
            来源: '泄洪操作',
            关联编号: flood.操作编号,
            责任班组: owner,
          })
        }
        if (flood.操作状态 === '泄洪中') {
          reminders.push({
            key: `flood-running-${flood.id}`,
            事项: `${flood.操作编号} 正在泄洪：${flood.泄洪闸号} 开启 ${flood.开启孔数} 孔，流量 ${flood.泄洪流量} m³/s`,
            来源: '泄洪操作',
            关联编号: flood.操作编号,
            责任班组: owner,
          })
        }
      }

      // 3) 拦污栅待清理。
      const racks = listRows('trashrack') as unknown as TrashrackRow[]
      for (const rack of racks) {
        if (rack.栅体状态 === '待清理' || rack.栅体状态 === '清理中') {
          reminders.push({
            key: `rack-${rack.id}`,
            事项: `拦污栅 ${rack.栅体编号}（${rack.所属机组}）${rack.栅体状态}，压差 ${rack.前后压差} m；跨页累计清污 ${canonicalCleaningTotal()} 条`,
            来源: '拦污栅',
            关联编号: rack.栅体编号,
            责任班组: '',
          })
        }
      }

      // 4) 到期授权由 activeGrant 自动过滤，额外列出「已到期未续」的提醒。
      const grants = listTable<GrantRow>('grants')
      for (const grant of grants) {
        if (grant.状态 === '已到期') {
          reminders.push({
            key: `grant-expired-${grant.id}`,
            事项: `闸门 ${grant.闸门编号} 对${crewName(grant.借用班组)}的临时授权已到期，操作权已自动收回${crewName(grant.原班组)}`,
            来源: '临时授权',
            关联编号: grant.闸门编号,
            责任班组: grant.原班组,
          })
        }
      }

      this.reminders = reminders
      this.manual = listTable<TodoRow>(TODO_TABLE)
      this.version += 1
    },
    addTodo(input: { 事项: string; 来源: string; 关联编号: string; 责任班组: string }) {
      const rows = listTable<TodoRow>(TODO_TABLE)
      rows.push({
        id: nextId(rows),
        事项: input.事项,
        来源: input.来源,
        关联编号: input.关联编号,
        责任班组: input.责任班组,
        产生时间: nowIso(),
        状态: '待办',
      })
      saveTable(TODO_TABLE, rows)
      this.refresh()
    },
    completeTodo(id: number) {
      const rows = listTable<TodoRow>(TODO_TABLE)
      const row = rows.find((item) => item.id === id)
      if (row) {
        row.状态 = '已完成'
        row.完成时间 = businessDate()
        saveTable(TODO_TABLE, rows)
      }
      this.refresh()
    },
  },
})
