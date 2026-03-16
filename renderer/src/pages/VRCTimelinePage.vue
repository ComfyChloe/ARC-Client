<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useElectronAPI } from '../composables/useElectronAPI'

type TimelineWebviewEvent = Event & {
  url?: string
  preventDefault?: () => void
}

const api = useElectronAPI()
const webviewRef = ref<any>(null)
const pendingUrl = ref('')
const showLinkModal = ref(false)
const sanitizedUrl = computed(() => pendingUrl.value || 'https://vrc.tl/')

function maybeHandleLink(url?: string) {
  if (!url || url.startsWith('https://vrc.tl/') || url === 'https://vrc.tl') {
    return false
  }
  pendingUrl.value = url
  showLinkModal.value = true
  return true
}

function handleWillNavigate(event: TimelineWebviewEvent) {
  if (maybeHandleLink(event.url)) {
    event.preventDefault?.()
  }
}

function handleNewWindow(event: TimelineWebviewEvent) {
  if (maybeHandleLink(event.url)) {
    event.preventDefault?.()
  }
}

function closeModal() {
  showLinkModal.value = false
}

function copyLink() {
  void api.clipboardWriteText(sanitizedUrl.value)
  closeModal()
}

function openInBrowser() {
  void api.openExternal(sanitizedUrl.value)
  closeModal()
}

onMounted(() => {
  const webview = webviewRef.value
  if (!webview) {
    return
  }
  webview.addEventListener('will-navigate', handleWillNavigate as EventListener)
  webview.addEventListener('new-window', handleNewWindow as EventListener)
})

onBeforeUnmount(() => {
  const webview = webviewRef.value
  if (!webview) {
    return
  }
  webview.removeEventListener('will-navigate', handleWillNavigate as EventListener)
  webview.removeEventListener('new-window', handleNewWindow as EventListener)
})
</script>

<template>
  <div class="page-view">
    <div class="header">
      <h1>VRC Timeline</h1>
      <p>Browse VRChat community events and activities</p>
      <p><b>Note: Please note this feature is experimental in client, It might break.</b></p>
    </div>
    <div class="card" style="padding: 0; height: calc(100vh - 200px); overflow: hidden;">
      <webview
        ref="webviewRef"
        src="https://vrc.tl/"
        style="width: 100%; height: 100%; display: inline-flex;"
        partition="persist:vrc-timeline"
        webpreferences="nodeIntegration=no,contextIsolation=yes"
      ></webview>
    </div>
    <div v-if="showLinkModal" class="timeline-link-modal-backdrop" @click.self="closeModal">
      <div class="timeline-link-modal">
        <h3>Open Link</h3>
        <p>{{ sanitizedUrl }}</p>
        <div class="timeline-link-actions">
          <button class="btn btn-secondary" type="button" @click="closeModal">Cancel</button>
          <button class="btn btn-primary" type="button" @click="copyLink">Copy Link</button>
          <button class="btn btn-primary" type="button" @click="openInBrowser">Open in Browser</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timeline-link-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  z-index: 10000;
}
.timeline-link-modal {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: #2c2c2c;
  padding: 25px;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  max-width: 450px;
  width: 90%;
}
.timeline-link-modal h3 {
  margin-top: 0;
  color: #fff;
}
.timeline-link-modal p {
  margin-bottom: 20px;
  color: #aaa;
  font-size: 14px;
  line-height: 1.5;
  word-break: break-all;
}
.timeline-link-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  flex-wrap: wrap;
}
</style>