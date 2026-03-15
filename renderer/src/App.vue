<script setup lang="ts">
import { ref } from 'vue'
import { useOscStatus } from './composables/useOscStatus'
import { useServerConnection } from './composables/useServerConnection'

const { serverRunning } = useOscStatus()
const { isConnected, isAuthenticated } = useServerConnection()

const extrasOpen = ref(false)
</script>

<template>
  <div id="arc-app">
    <nav class="sidebar">
      <div class="sidebar-header">
        <h1>ARC</h1>
      </div>
      <div class="nav-links">
        <router-link to="/" class="nav-item">Dashboard</router-link>
        <router-link to="/osc" class="nav-item">OSC</router-link>
        <router-link to="/logs" class="nav-item">Logs</router-link>
        <router-link to="/settings" class="nav-item">Settings</router-link>
        <div class="nav-group">
          <button class="nav-item nav-group-toggle" @click="extrasOpen = !extrasOpen">
            Extras
            <span class="arrow" :class="{ open: extrasOpen }">&#9662;</span>
          </button>
          <div v-show="extrasOpen" class="nav-group-children">
            <router-link to="/hyperate" class="nav-item sub">HypeRate</router-link>
            <router-link to="/oscleash" class="nav-item sub">OSC Leash</router-link>
            <router-link to="/oscgoesbrrr" class="nav-item sub">OscGoesBrrr</router-link>
            <router-link to="/autostatus" class="nav-item sub">Auto Status</router-link>
            <router-link to="/vrchat-api" class="nav-item sub">VRChat API</router-link>
            <router-link to="/feedback" class="nav-item sub">Feedback</router-link>
            <router-link to="/calendar" class="nav-item sub">Calendar</router-link>
            <router-link to="/openshock" class="nav-item sub">OpenShock</router-link>
            <router-link to="/arclink" class="nav-item sub">ARC Link</router-link>
          </div>
        </div>
      </div>
      <div class="sidebar-footer">
        <div class="status-indicators">
          <span class="status-dot" :class="{ active: serverRunning }" title="OSC Server"></span>
          <span class="status-dot" :class="{ active: isConnected }" title="WebSocket"></span>
          <span class="status-dot" :class="{ active: isAuthenticated }" title="Authenticated"></span>
        </div>
      </div>
    </nav>
    <main class="content">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
#arc-app {
  display: flex;
  height: 100vh;
  background: #1a1a2e;
  color: #ffffff;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}
.sidebar {
  width: 200px;
  background: #16213e;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #0f3460;
}
.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid #0f3460;
}
.sidebar-header h1 {
  margin: 0;
  font-size: 1.4rem;
  color: #e94560;
}
.nav-links {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}
.nav-item {
  display: block;
  padding: 10px 16px;
  color: #a0a0b8;
  text-decoration: none;
  font-size: 0.9rem;
  cursor: pointer;
  border: none;
  background: none;
  width: 100%;
  text-align: left;
  font-family: inherit;
}
.nav-item:hover {
  background: #1a1a40;
  color: #ffffff;
}
.nav-item.router-link-active {
  background: #0f3460;
  color: #e94560;
}
.nav-item.sub {
  padding-left: 32px;
  font-size: 0.85rem;
}
.nav-group-toggle {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.arrow {
  font-size: 0.7rem;
  transition: transform 0.2s;
}
.arrow.open {
  transform: rotate(180deg);
}
.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid #0f3460;
}
.status-indicators {
  display: flex;
  gap: 8px;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #555;
}
.status-dot.active {
  background: #4caf50;
}
.content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}
</style>
