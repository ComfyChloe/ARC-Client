<script setup lang="ts">
import { useServerConnection, type PanelInfo } from '../composables/useServerConnection'

const {
  isConnected,
  isAuthenticated,
  panelConnectionsData
} = useServerConnection()

function safetyStatuses(panel: PanelInfo): boolean[] {
  return [panel.safetyEnabled, panel.safety2Enabled, panel.safety3Enabled, panel.safety4Enabled, panel.safety5Enabled]
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
                <span class="panel-lock-badge" :class="panel.panelEnabled ? 'unlocked' : 'locked'">
                  {{ panel.panelEnabled ? 'Unlocked' : 'Locked' }}
                </span>
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
                <span v-for="(enabled, i) in safetyStatuses(panel)" :key="i" class="safety-bubble" :class="enabled ? 'enabled' : 'disabled'">
                  {{ i + 1 }}
                </span>
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
