import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import './styles/global.css'
import { bootstrapDomain } from './domain/bootstrap'
import { reconcile } from './domain/gate-service'

// 首次进入播种归属台账与历史记录；两套取值有争议的，启动即按「较晚产生的为准」统一一次。
bootstrapDomain()
reconcile()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
