import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './assets/global.css'
import { registerWhisperCapture } from './services/whisperCapture'

registerWhisperCapture()
createApp(App).use(router).mount('#app')
