import { ref, onMounted } from 'vue'
import { useElectronAPI } from './useElectronAPI'

export function useServerConnection() {
  const api = useElectronAPI()
  const isConnected = ref(false)
  const isAuthenticated = ref(false)
  const currentAvatar = ref<string | null>(null)
  const parameters = ref<Record<string, any>>({})
  const panelConnections = ref(0)

  onMounted(() => {
    api.onWebSocketStatus((data: any) => {
      isConnected.value = data.connected ?? false
    })
    api.onWebSocketAuthenticated((data: any) => {
      isAuthenticated.value = data.authenticated ?? false
    })
    api.onWebSocketAvatarChange((data: any) => {
      currentAvatar.value = data.avatarId ?? null
    })
    api.onWebSocketParameterUpdate((data: any) => {
      if (data.name) {
        parameters.value[data.name] = data.value
      }
    })
    api.onWebSocketPanelConnectionsUpdate((data: any) => {
      panelConnections.value = data.count ?? 0
    })
  })

  return { isConnected, isAuthenticated, currentAvatar, parameters, panelConnections }
}
