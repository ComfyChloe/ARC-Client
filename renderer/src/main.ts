import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './assets/global.css'
import { registerVoskCapture } from './services/voskCapture'
import { registerWhisperCapture } from './services/whisperCapture'

registerVoskCapture()
registerWhisperCapture()
createApp(App).use(router).mount('#app')
