import { listTable } from '@/data/local-store'
import type { MissingFieldRow, SyncLogRow, TwinRow } from './types'

// 领域数据只读查询出口：页面展示缺项清单、取值对齐结果、同步日志用。

export function listMissingFields(): MissingFieldRow[] {
  return listTable<MissingFieldRow>('missingFields').sort((a, b) =>
    b.登记时间.localeCompare(a.登记时间),
  )
}

export function listTwins(): TwinRow[] {
  return listTable<TwinRow>('twins')
}

export function listSyncLogs(): SyncLogRow[] {
  return listTable<SyncLogRow>('syncLogs').sort((a, b) =>
    b.处理时间.localeCompare(a.处理时间),
  )
}
