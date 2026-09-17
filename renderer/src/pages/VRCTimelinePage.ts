// ====
// VRCTimelinePage state factory — sibling script module for VRCTimelinePage.vue.
// Owns the webview ref, external-link interception modal, and clipboard/
// browser open handlers.
// Call createVRCTimelinePageState() once from <script setup>.
// ====
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useElectronAPI } from '../composables/useElectronAPI'

type TimelineWebviewEvent = Event & {
  url?: string
  preventDefault?: () => void
}

export function createVRCTimelinePageState() {
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
  return {
    webviewRef,
    pendingUrl,
    showLinkModal,
    sanitizedUrl,
    handleWillNavigate,
    handleNewWindow,
    closeModal,
    copyLink,
    openInBrowser
  }
}
