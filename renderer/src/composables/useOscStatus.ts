import { ref, onMounted } from 'vue'
import { useElectronAPI } from './useElectronAPI'

export function useOscStatus() {
  const api = useElectronAPI()
  const serverRunning = ref(false)
  const serverPort = ref(0)
  const queryRunning = ref(false)

  onMounted(() => {
    api.onOscServerStatus((data: any) => {
      serverRunning.value = data.running ?? false
      serverPort.value = data.port ?? 0
    })
    api.onOscQueryStatus((data: any) => {
      queryRunning.value = data.running ?? false
    })
  })

  return { serverRunning, serverPort, queryRunning }
}
