<script setup lang="ts">
import { useElectronAPI } from '../composables/useElectronAPI'

const api = useElectronAPI()

function openTimelineInBrowser() {
  void api.openExternal('https://vrc.tl/')
}
</script>

<template>
  <div class="page-view">
    <div class="header">
      <h1>VRC Timeline</h1>
      <p>Browse VRChat community events and activities</p>
      <p><strong>Note:</strong> This feature is experimental in client and may break.</p>
    </div>
    <div class="card" style="padding: 0; height: calc(100vh - 200px); overflow: hidden;">
      <webview
        src="https://vrc.tl/"
        style="width: 100%; height: 100%; display: inline-flex;"
        partition="persist:vrc-timeline"
        webpreferences="nodeIntegration=no,contextIsolation=yes"
      ></webview>
    </div>
    <div class="card">
      <button class="btn btn-primary" type="button" @click="openTimelineInBrowser">Open in Browser</button>
    </div>
  </div>
</template>