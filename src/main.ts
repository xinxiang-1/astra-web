import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'

import App from './App.vue'
import router from './router'
import './styles/tokens.css'
import './styles/art-system.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(ElementPlus)

app.mount('#app')

// Brand font delivery must not hold up the editor when the external CSS stalls.
const brandFonts = document.createElement('link')
brandFonts.rel = 'stylesheet'
brandFonts.href =
  'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&family=Syne:wght@500;600;700;750&display=swap'
document.head.appendChild(brandFonts)
