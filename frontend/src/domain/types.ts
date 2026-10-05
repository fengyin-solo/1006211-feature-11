/** 闸门归属、调班授权、操作记录、取值对齐等领域模型的公共类型。 */

export type Role = '运行岗' | '检修岗' | '观测岗'

/** 班组：闸门归属于班组而不是个人。 */
export type Crew = {
  code: string
  name: string
  role: Role
}

/** 当前操作人（顶栏可切换，用来演示越权拦截）。 */
export type Actor = {
  name: string
  crewCode: string
  role: Role
}

/** 一扇闸门：除原有台账字段外，登记责任班组与操作范围（归属只允许责任班组改）。 */
export type GateRow = {
  id: number
  闸门编号: string
  闸门类型: string
  孔口尺寸: string
  当前开度: number
  启闭机型号: string
  /** 责任班组编码 */
  责任班组: string
  /** 操作范围：表孔 / 深孔 / 检修等，泄洪孔口按闸段归集 */
  操作范围: string
  /** 所属闸段（和泄洪操作的泄洪闸号对应），检修闸门不参与孔数统计 */
  闸段: string
  参与泄洪: boolean
  操作人员: string
  操作时间: string
  闸门状态: string
  status: string
  pending: boolean
  abnormal: boolean
  /** 最近一次开度产生时间（孔数对齐时作为「闸门这套取值」的产生时间） */
  开度更新时间?: string
}

/** 调班临时授权：到期自动收回；授权期间的操作记录仍归原班组。 */
export type GrantRow = {
  id: number
  gateId: number
  闸门编号: string
  /** 原责任班组（授权期间操作记录仍记这个班组） */
  原班组: string
  /** 借用人所属班组 */
  借用班组: string
  借用人: string
  授权开始: string
  授权到期: string
  授权原因: string
  状态: '生效中' | '已到期' | '已收回'
}

/** 闸门操作记录：每条开启/关闭/故障/审批/归属变更都留痕。 */
export type GateLogRow = {
  id: number
  gateId: number
  闸门编号: string
  操作类型: string
  操作开度: number
  操作时间: string
  /** 操作时间的 ISO 形式，用于去重时间窗与排序（展示仍用本地格式的「操作时间」） */
  时间戳Iso: string
  实际操作人: string
  /** 记录归属班组：永远是闸门原责任班组，借用期间也不改 */
  归属班组: string
  操作班组: string
  授权依据: string
  结果: string
  业务日期: string
  /** 回填/对齐产生的记录标注来源，正常实时操作为空 */
  来源: string
}

/** 泄洪操作：在原台账字段基础上带各字段产生时间，供「两套取值谁晚谁为准」判定。 */
export type FloodRow = {
  id: number
  操作编号: string
  泄洪闸号: string
  开启孔数: number
  泄洪流量: number
  下游预警: string
  操作时间: string
  操作人员: string
  操作状态: string
  /** 开启孔数这套取值的产生时间 */
  孔数更新时间: string
  /** 孔数来源：闸门实测同步 / 泄洪登记 / 取值对齐 */
  孔数来源: string
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type TrashrackRow = {
  id: number
  栅体编号: string
  所属机组: string
  前后压差: number
  清污次数: number
  清污方式: string
  清理日期: string
  清理人员: string
  栅体状态: string
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

/** 跨页双份取值：A/B 两侧各自带产生时间，按较晚的一套统一。 */
export type TwinRow = {
  id: number
  twinKey: string
  label: string
  sideAName: string
  sideAValue: number
  sideATime: string
  sideBName: string
  sideBValue: number
  sideBTime: string
  /** 统一后的取值 */
  统一值: number
  统一来源: string
  统一时间: string
  unit: string
}

export type SyncLogRow = {
  id: number
  业务: string
  twinKey: string
  对齐结果: string
  保留值: number
  落选值: number
  依据: string
  处理时间: string
  业务日期: string
}

/** 历史补数时登记的缺项清单。 */
export type MissingFieldRow = {
  id: number
  来源模块: string
  来源编号: string
  缺失字段: string
  补数办法: string
  补入值: string
  业务日期: string
  登记时间: string
}

export type TodoRow = {
  id: number
  事项: string
  来源: string
  关联编号: string
  责任班组: string
  产生时间: string
  状态: '待办' | '已完成'
  完成时间?: string
}

export type ActionResult = {
  ok: boolean
  message: string
}
