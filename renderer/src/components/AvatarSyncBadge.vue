<script setup lang="ts">
// Logic lives in the sibling AvatarSyncBadge.ts factory — keep this block thin.
import { createAvatarSyncBadgeState } from './AvatarSyncBadge'
const props = defineProps<{
  localAvatarId: string | null
  confirmedAvatarId: string | null
}>()
const { state, shortId } = createAvatarSyncBadgeState(props)
</script>

<template>
  <section class="avatar-sync-badge" :class="`avatar-sync-${state}`" aria-label="Avatar state confirmation">
    <div class="avatar-sync-heading">
      <span>Avatar State</span>
      <span class="avatar-sync-mark" aria-hidden="true">
        <span v-if="state === 'matched'">&#10003;</span>
        <span v-else-if="state === 'mismatch'">&#10005;</span>
        <span v-else>&mdash;</span>
      </span>
    </div>
    <div class="avatar-sync-row"><span>VRChat</span><code>{{ shortId(localAvatarId) }}</code></div>
    <div class="avatar-sync-row"><span>ARC</span><code>{{ shortId(confirmedAvatarId) }}</code></div>
  </section>
</template>

<style scoped>
.avatar-sync-badge {
  border: 1px solid var(--border-color, rgba(127, 127, 127, 0.35));
  border-radius: 8px;
  padding: 12px 14px;
  min-width: 220px;
  background: var(--card-background, rgba(127, 127, 127, 0.08));
}
.avatar-sync-heading, .avatar-sync-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.avatar-sync-heading { font-weight: 700; margin-bottom: 8px; }
.avatar-sync-row { font-size: 13px; margin-top: 5px; }
.avatar-sync-row code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.avatar-sync-mark { font-size: 18px; }
.avatar-sync-matched .avatar-sync-mark { color: #2ecc71; }
.avatar-sync-mismatch .avatar-sync-mark { color: #e74c3c; }
.avatar-sync-unknown .avatar-sync-mark { color: #f39c12; }
@media (max-width: 520px) { .avatar-sync-badge { min-width: 0; width: 100%; } }
</style>