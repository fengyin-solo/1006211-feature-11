import { SEED_DOMAIN, SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydropower-plant-om:entries'
// 闸门归属、授权、操作记录、取值对齐等领域表，单独存一个键，和原台账互不影响。
const DOMAIN_KEY = 'hydropower-plant-om:domain'

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

// ---- 领域通用表（闸门归属/授权/记录/取值对齐都走这里） ----

type DomainShape = Record<string, unknown[]>
let domainCache: DomainShape | null = null

function domainSeed(): DomainShape {
  return clone(SEED_DOMAIN as DomainShape)
}

function domainAll(): DomainShape {
  if (domainCache === null) {
    domainCache = readJson<DomainShape>(DOMAIN_KEY, domainSeed())
  }
  return domainCache
}

export function listTable<T>(name: string): T[] {
  return (domainAll()[name] ?? []) as T[]
}

export function saveTable<T>(name: string, rows: T[]): void {
  const next = { ...domainAll(), [name]: rows }
  domainCache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(DOMAIN_KEY, JSON.stringify(next))
  }
}

export function nextId<T extends { id: number }>(rows: T[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

/** 测试与「重置演示数据」用：清掉领域库并回到播种态。 */
export function resetDomain(): void {
  domainCache = null
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(DOMAIN_KEY)
  }
  void domainAll()
}

export function storageKey(): string {
  return STORAGE_KEY
}
