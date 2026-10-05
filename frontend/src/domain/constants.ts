// 组织口径：岗位属于班组，归属一律落在班组上，不落在具体人头上。
// 调班借权也是「班组对班组」的临时授权，操作记录归属始终记原责任班组。

export type CrewKey = 'RUN1' | 'RUN2' | 'MAINT' | 'CLEAN' | 'HYDRO'

export type CrewInfo = {
  key: CrewKey
  name: string
  post: string
  desc: string
}

export const CREWS: Record<CrewKey, CrewInfo> = {
  RUN1: { key: 'RUN1', name: '运行一班', post: '运行岗', desc: '负责表孔工作闸门日常启闭' },
  RUN2: { key: 'RUN2', name: '运行二班', post: '运行岗', desc: '负责底孔泄洪闸门启闭与泄洪配合' },
  MAINT: { key: 'MAINT', name: '检修班', post: '检修岗', desc: '负责检修闸门、检修工作票与设备缺陷' },
  CLEAN: { key: 'CLEAN', name: '清污班', post: '清污岗', desc: '负责拦污栅清污作业' },
  HYDRO: { key: 'HYDRO', name: '水情班', post: '水情岗', desc: '负责水情调度与泄洪审批值守' },
}

export const CREW_NAMES: string[] = Object.values(CREWS).map((item) => item.name)

export type OperatorInfo = {
  name: string
  crew: CrewKey
}

// 可在顶栏切换的值班人：与「检修人员」台账里的名单保持同一套口径。
export const OPERATORS: OperatorInfo[] = [
  { name: '张运行', crew: 'RUN1' },
  { name: '李开启', crew: 'RUN1' },
  { name: '王泄洪', crew: 'RUN2' },
  { name: '陈底孔', crew: 'RUN2' },
  { name: '赵检修', crew: 'MAINT' },
  { name: '孙工作', crew: 'MAINT' },
  { name: '周清污', crew: 'CLEAN' },
  { name: '吴水清', crew: 'CLEAN' },
  { name: '郑调度', crew: 'HYDRO' },
]

export function crewNameOf(key: string): string {
  return CREWS[key as CrewKey]?.name ?? key
}

export function postOfCrew(key: string): string {
  return CREWS[key as CrewKey]?.post ?? ''
}

// 同一扇闸门同一动作的去重窗口：窗口内后到的提交一律按重复拒绝。
export const DUP_WINDOW_MS = 5 * 60 * 1000
