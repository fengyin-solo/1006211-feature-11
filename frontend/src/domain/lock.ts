// 同一时刻并发写入保护：纯前端单线程环境下，用「业务键 + 秒桶」的一次性消费记录，
// 同一秒内对同一业务键到达的第二笔按重复处理。

const consumed = new Map<string, string>()

export type WithLockResult<T> =
  | { locked: false; value: T }
  | { locked: true }

/**
 * 尝试在业务键上加锁执行。同一秒桶内该键已被消费过（同一时刻并发）时直接判重，
 * 不执行写入；进入下一秒后视为新时刻，可以再写一笔。
 */
export function withWriteLock<T>(key: string, fn: () => T): WithLockResult<T> {
  const bucket = new Date().toISOString().slice(0, 19)
  if (consumed.get(key) === bucket) {
    return { locked: true }
  }
  consumed.set(key, bucket)
  try {
    return { locked: false, value: fn() }
  } finally {
    // 保留消费记录到本秒结束（不立即释放），从而挡住同一时刻的并发写入。
  }
}

export function isLocked(key: string): boolean {
  return consumed.get(key) === new Date().toISOString().slice(0, 19)
}
