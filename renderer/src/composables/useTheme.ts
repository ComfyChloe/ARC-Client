// ====
// Shared dark-theme observation composable.
// Several pages previously re-implemented the same MutationObserver
// pattern (syncThemeState + observe body class changes). This composable
// centralizes it: call useTheme() in a page factory, read isDarkTheme,
// and the observer is registered/cleaned up via start/stop or automatic
// onMounted/onUnmounted binding.
// ====
import { onMounted, onUnmounted, ref } from 'vue'

export function useTheme() {
  const isDarkTheme = ref(false)
  let observer: MutationObserver | null = null
  function syncThemeState() {
    if (typeof document === 'undefined') return
    isDarkTheme.value = document.body.classList.contains('dark-theme')
  }
  function startThemeObserver() {
    syncThemeState()
    if (typeof document === 'undefined') return
    observer = new MutationObserver(syncThemeState)
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  }
  function stopThemeObserver() {
    observer?.disconnect()
    observer = null
  }
  onMounted(startThemeObserver)
  onUnmounted(stopThemeObserver)
  return { isDarkTheme, syncThemeState, startThemeObserver, stopThemeObserver }
}
