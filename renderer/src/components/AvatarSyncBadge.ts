// ====
// AvatarSyncBadge state factory — sibling script module for
// AvatarSyncBadge.vue. Small component: computes sync state and the
// shortened avatar-ID display from the local/confirmed props.
// Call createAvatarSyncBadgeState() once from <script setup>.
// ====
import { computed } from 'vue'

export function createAvatarSyncBadgeState(props: {
  localAvatarId: string | null
  confirmedAvatarId: string | null
}) {
  const state = computed(() => {
    if (!props.localAvatarId || !props.confirmedAvatarId) return 'unknown'
    return props.localAvatarId === props.confirmedAvatarId ? 'matched' : 'mismatch'
  })
  function shortId(value: string | null): string {
    if (!value) return 'Unknown'
    return value.length > 16 ? `...${value.slice(-12)}` : value
  }
  return {
    state,
    shortId
  }
}
