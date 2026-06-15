<script setup lang="ts">
import { useServerConnection, type PanelInfo } from '../composables/useServerConnection'

const {
  isConnected,
  isAuthenticated,
  panelConnectionsData,
  pendingPanelToggles,
  setPanelState
} = useServerConnection()

function safetyStatuses(panel: PanelInfo): boolean[] {
  return [panel.safetyEnabled, panel.safety2Enabled, panel.safety3Enabled, panel.safety4Enabled, panel.safety5Enabled]
}

function togglePanelLock(panel: PanelInfo) {
  setPanelState('panel', !panel.panelEnabled)
}

function toggleSafety(panel: PanelInfo, index: number) {
  const kind = `safety${index + 1}` as const
  const currentValue = safetyStatuses(panel)[index]
  setPanelState(kind, !currentValue)
}
function linksBreakdown(panel: PanelInfo): string {
  const parts: string[] = []
  if (panel.friendLinkCount > 0) parts.push(`F:${panel.friendLinkCount}`)
  if (panel.publicLinkCount > 0) parts.push(`P:${panel.publicLinkCount}`)
  return parts.length > 0 ? ` (${parts.join(' ')})` : ''
}
</script>

<template>
  <div class="page-view">
    <div class="header">
      <h1>ARC-OSC Client</h1>
      <p>Real-time OSC communication with VRChat</p>
    </div>
    <div class="tabs">
      <button class="tab active" type="button">My Panels</button>
    </div>
    <div class="tab-content active">
      <div class="card">
        <h3>Panel Dashboard</h3>
        <div class="panels-grid">
          <p v-if="!isAuthenticated || !isConnected" class="panels-loading">
            Connect and authenticate to view your panels
          </p>
          <p v-else-if="Object.keys(panelConnectionsData).length === 0" class="panels-loading">
            No panels found. Create panels in the ARC dashboard.
          </p>
          <div v-for="(panel, panelId) in panelConnectionsData" v-else :key="panelId" class="panel-card">
            <div class="panel-card-header">
              <h4 class="panel-name">{{ panel.panelName }}</h4>
              <div class="panel-card-badges">
                <button type="button" class="panel-lock-badge" :class="[panel.panelEnabled ? 'unlocked' : 'locked', { pending: pendingPanelToggles.has('panel') }]" :disabled="!isConnected || !isAuthenticated || pendingPanelToggles.has('panel')" :aria-pressed="panel.panelEnabled" :title="panel.panelEnabled ? 'Click to lock panel' : 'Click to unlock panel'" @click="togglePanelLock(panel)">
                  {{ panel.panelEnabled ? 'Unlocked' : 'Locked' }}
                </button>
                <span class="panel-status-badge" :class="panel.isActive ? 'active' : 'inactive'">
                  {{ panel.isActive ? 'Active' : 'Inactive' }}
                </span>
              </div>
            </div>
            <div class="panel-stats">
              <div class="panel-stat">
                <span class="panel-stat-value">{{ panel.connectionCount }}</span>
                <span class="panel-stat-label">Connections</span>
              </div>
            </div>
            <div class="safety-bubbles-row">
              <span class="safety-label">Safety</span>
              <div class="safety-bubbles">
                <button v-for="(enabled, i) in safetyStatuses(panel)" :key="i" type="button" class="safety-bubble" :class="[enabled ? 'enabled' : 'disabled', { pending: pendingPanelToggles.has(`safety${i + 1}`) }]" :disabled="!isConnected || !isAuthenticated || pendingPanelToggles.has(`safety${i + 1}`)" :aria-pressed="enabled" :title="enabled ? `Click to disengage safety ${i + 1}` : `Click to engage safety ${i + 1}`" @click="toggleSafety(panel, i)">
                  {{ i + 1 }}
                </button>
              </div>
            </div>
            <div class="access-indicators-row">
              <span class="access-indicator" :class="panel.isPublic ? 'public' : 'private'">
                {{ panel.isPublic ? 'Public' : 'Private' }}
              </span>
              <span class="access-indicator" :class="panel.hasPassword ? 'active' : 'inactive'">Pass</span>
              <span class="access-indicator" :class="panel.allowFriends ? 'friends' : 'inactive'">Friends</span>
              <span v-if="panel.activeLinkCount > 0" class="access-indicator links">
                L:{{ panel.activeLinkCount }}{{ linksBreakdown(panel) }}
              </span>
              <span v-else class="access-indicator inactive">Links</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
