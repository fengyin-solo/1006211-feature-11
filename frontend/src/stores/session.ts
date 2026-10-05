import { defineStore } from 'pinia'

import { CREWS, OPERATORS, type CrewKey, type OperatorInfo } from '@/domain/constants'

export const useSessionStore = defineStore('session', {
  state: () => {
    const initial: OperatorInfo = OPERATORS[0]
    return {
      operator: initial.name,
      crew: initial.crew as CrewKey,
      shiftLabel: '白班 08:00-20:00',
      scope: '水电站机组运行检修管理平台',
    }
  },
  getters: {
    canOperate: (state) => state.operator.length > 0,
    crewName: (state) => CREWS[state.crew].name,
    postName: (state) => CREWS[state.crew].post,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setOperator(name: string) {
      const found = OPERATORS.find((item) => item.name === name)
      if (!found) {
        return
      }
      this.operator = found.name
      this.crew = found.crew
    },
  },
})
