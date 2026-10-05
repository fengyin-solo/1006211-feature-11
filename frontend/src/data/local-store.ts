import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// v2：闸门/泄洪/拦污栅引入归属与真实业务字段，旧示例数据结构不再兼容，直接重新播种。
const STORAGE_KEY = 'hydropower-plant-om:entries:v2'
// 闸门归属、授权、操作台账、清污台账、对账报告等领域数据单独存放。
const DOMAIN_KEY = 'hydropower-plant-om:domain:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(fallback)
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// ---- 领域台账（授权 / 操作记录 / 清污台账 / 对账报告）----

export type DomainTables = {
  gateAuth: unknown[]
  gateLedger: unknown[]
  cleanLedger: unknown[]
  reports: unknown[]
  bootstrappedAt: string | null
}

const EMPTY_DOMAIN: DomainTables = {
  gateAuth: [],
  gateLedger: [],
  cleanLedger: [],
  reports: [],
  bootstrappedAt: null,
}

let domainCache: DomainTables | null = null

// 每次都从 localStorage 重新读取：同一浏览器多标签页并发提交时，
// 后一个标签页能看到前一个刚写入的台账，配合业务键去重只保留一笔。
export function readDomain(): DomainTables {
  const stored = readJson<Partial<DomainTables>>(DOMAIN_KEY, {})
  return {
    gateAuth: stored.gateAuth ?? [],
    gateLedger: stored.gateLedger ?? [],
    cleanLedger: stored.cleanLedger ?? [],
    reports: stored.reports ?? [],
    bootstrappedAt: stored.bootstrappedAt ?? null,
  }
}

export function getDomain(): DomainTables {
  // 有意不长期缓存：跨标签页并发写入靠这里读最新值判重。
  domainCache = readDomain()
  return domainCache
}

export function saveDomain(next: DomainTables): void {
  domainCache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(DOMAIN_KEY, JSON.stringify(next))
  }
}

export function resetDomain(): void {
  domainCache = null
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(DOMAIN_KEY)
  }
}

export function domainKey(): string {
  return DOMAIN_KEY
}
