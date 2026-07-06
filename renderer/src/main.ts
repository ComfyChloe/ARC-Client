import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './assets/global.css'
import { registerVoskCapture } from './services/voskCapture'

registerVoskCapture()
createApp(App).use(router).mount('#app')
