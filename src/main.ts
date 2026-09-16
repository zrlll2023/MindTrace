import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useThemeStore } from './stores/theme'
import '@vuepic/vue-datepicker/dist/main.css'
import './style.css'

// 主题已在 index.html 的内联脚本中落地（避免首帧闪白/闪黑），
// 这里再交给 store 统一接管并监听系统切换
const app = createApp(App)
app.use(createPinia())
app.use(router)

useThemeStore().init()

app.mount('#app')
