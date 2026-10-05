// 统一时间口径：台账、授权、对账都用本地时间字符串存储，比较时换算为毫秒。

export function nowMs(): number {
  return Date.now()
}

export function formatTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

export function nowText(): string {
  return formatTime(Date.now())
}

export function parseTime(text: string): number {
  if (!text) {
    return NaN
  }
  // 兼容「2026-10-01 09:00:00」与「2026-10-01」两种业务日期写法。
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text.trim())
    ? `${text.trim()} 00:00:00`
    : text.trim().replace('T', ' ')
  const d = new Date(normalized.replace(/-/g, '/'))
  return d.getTime()
}

export function hoursAgo(base: number, hours: number): number {
  return base - hours * 3600 * 1000
}
