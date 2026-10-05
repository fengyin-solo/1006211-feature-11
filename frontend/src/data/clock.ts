// 统一时钟：业务规则（授权到期、取值时间戳、操作去重）都从这里取时间，测试时可注入固定时钟。

export type Clock = () => Date

let current: Clock = () => new Date()

export function now(): Date {
  return current()
}

export function nowIso(): string {
  return now().toISOString()
}

export function today(): string {
  const d = now()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function setClock(clock: Clock): void {
  current = clock
}

/** 同一时刻判定：精确到秒。同一秒内对同一键的并发写入只认第一笔。 */
export function secondBucket(date: Date = now()): string {
  return date.toISOString().slice(0, 19)
}

/** 同一时段判定：同一扇闸门、同方向操作，一分钟内只认第一条。 */
export function minuteSlot(date: Date = now()): string {
  return date.toISOString().slice(0, 16)
}

/** 业务日期（yyyy-MM-dd，按本地时区），历史数据按业务日期补数用。 */
export function businessDate(date: Date = now()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 历史缺项兜底用的本月首个业务日。 */
export function firstBusinessDayOfMonth(date: Date = now()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

/** 解析操作时间：兼容「yyyy-MM-dd HH:mm:ss」本地格式与 ISO，非法输入返回 invalid 由调用方兜底。 */
export function parseOpTime(text: string): Date {
  const value = String(text ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(value)) {
    const [datePart, timePart = '00:00:00'] = value.split(/[ T]/)
    const [y, m, d] = datePart.split('-').map(Number)
    const [hh, mm, ss = 0] = timePart.split(':').map(Number)
    return new Date(y, m - 1, d, hh, mm, ss)
  }
  return new Date(value)
}

/** 操作时间转 ISO，供比较与去重使用。 */
export function opTimeIso(text: string): string {
  const date = parseOpTime(text)
  return Number.isNaN(date.getTime()) ? '1970-01-01T00:00:00.000Z' : date.toISOString()
}
