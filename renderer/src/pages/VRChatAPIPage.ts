// ====
// VRChatAPIPage state factory — sibling script module for VRChatAPIPage.vue.
// Thin delegation: all login/2FA/link state lives in
// composables/useVRChatAPI.ts; this factory just re-exports it so the
// .vue keeps the single-factory convention.
// Call createVRChatAPIPageState() once from <script setup>.
// ====
import { useVRChatAPI } from '../composables/useVRChatAPI'

export function createVRChatAPIPageState() {
  const {
    status,
    stats,
    linkStatus,
    loading,
    error,
    loginUsername,
    loginPassword,
    twoFactorCode,
    isAuthenticated,
    isPending2FA,
    login,
    verify2FA,
    cancel2FA,
    logout,
    shareWithARC,
    checkLinkStatus
  } = useVRChatAPI()
  return {
    status,
    stats,
    linkStatus,
    loading,
    error,
    loginUsername,
    loginPassword,
    twoFactorCode,
    isAuthenticated,
    isPending2FA,
    login,
    verify2FA,
    cancel2FA,
    logout,
    shareWithARC,
    checkLinkStatus
  }
}
