import type { Actor, Crew } from './types'

// 班组台账：闸门归属到班组，运行岗与检修岗是责任班组，观测岗只读。
export const CREWS: Crew[] = [
  { code: 'RUN-A', name: '运行甲班', role: '运行岗' },
  { code: 'RUN-B', name: '运行乙班', role: '运行岗' },
  { code: 'MAINT', name: '检修班组', role: '检修岗' },
  { code: 'WATCH', name: '水情观测班', role: '观测岗' },
]

export const CREW_BY_CODE: Map<string, Crew> = new Map(CREWS.map((crew) => [crew.code, crew]))

export function crewName(code: string): string {
  return CREW_BY_CODE.get(code)?.name ?? code
}

// 顶栏可切换的登录身份，用来演示本班组放行、越权班组拒绝。
export const ACTORS: Actor[] = [
  { name: '张运行（甲班）', crewCode: 'RUN-A', role: '运行岗' },
  { name: '李运行（乙班）', crewCode: 'RUN-B', role: '运行岗' },
  { name: '王检修（检修班）', crewCode: 'MAINT', role: '检修岗' },
  { name: '赵观测（观测班）', crewCode: 'WATCH', role: '观测岗' },
]

export const DEFAULT_ACTOR: Actor = ACTORS[0]

/** 可成为闸门责任班组的只有运行岗、检修岗；观测岗只有只读权限。 */
export function canOwnGate(actor: Actor): boolean {
  return actor.role === '运行岗' || actor.role === '检修岗'
}
