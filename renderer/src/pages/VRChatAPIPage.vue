<script setup lang="ts">
import { useVRChatAPI } from '../composables/useVRChatAPI'

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
</script>

<template>
  <div class="page-view">
    <div class="header">
      <h1>VRChat API</h1>
      <p>Direct VRChat API integration for advanced features</p>
    </div>

    <div v-if="error" class="card">
      <p style="color: #e74c3c;">{{ error }}</p>
    </div>

    <div class="card">
      <h3>Connection Status</h3>
      <div class="connection-status">
        <span class="status-indicator" :class="isAuthenticated ? 'status-connected' : 'status-disconnected'"></span>
        <span>{{ isAuthenticated ? 'Authenticated' : 'Not Authenticated' }}</span>
      </div>
      <div v-if="status.currentUser" class="user-info-box">
        <div class="user-info-label">Logged in as:</div>
        <div class="user-info-display">{{ status.currentUser.displayName }}</div>
        <div class="vrchatapi-user-id">{{ status.currentUser.id }}</div>
      </div>
    </div>

    <div v-if="isPending2FA" class="card">
      <h3>Two-Factor Authentication</h3>
      <p>Method: {{ status.twoFactorMethods.includes('emailOtp') ? 'Email Code' : 'Authenticator App' }}</p>
      <div class="form-group">
        <label for="vrchatapi-2fa-code">Verification Code</label>
        <input id="vrchatapi-2fa-code" v-model="twoFactorCode" type="text" placeholder="Enter code" maxlength="6" @keyup.enter="verify2FA" />
      </div>
      <div style="display: flex; gap: 10px; margin-top: 20px;">
        <button class="btn btn-primary" type="button" :disabled="loading || !twoFactorCode" @click="verify2FA">Verify</button>
        <button class="btn btn-secondary" type="button" @click="cancel2FA">Cancel</button>
      </div>
    </div>

    <div v-else-if="!isAuthenticated" class="card">
      <h3>Authentication</h3>
      <div class="form-group">
        <label for="vrchatapi-username">VRChat Username or Email</label>
        <input id="vrchatapi-username" v-model="loginUsername" type="text" placeholder="Enter username or email" @keyup.enter="login" />
      </div>
      <div class="form-group">
        <label for="vrchatapi-password">Password</label>
        <input id="vrchatapi-password" v-model="loginPassword" type="password" placeholder="Enter password" @keyup.enter="login" />
      </div>
      <button class="btn btn-primary" type="button" :disabled="loading || !loginUsername || !loginPassword" @click="login">
        {{ loading ? 'Logging in...' : 'Login' }}
      </button>
    </div>

    <template v-else>
      <div class="card">
        <h3>Actions</h3>
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <button v-if="linkStatus !== 'linked'" class="btn btn-primary" type="button" @click="shareWithARC">Link to ARC</button>
          <button v-else class="btn btn-secondary" type="button" disabled>Account Linked</button>
          <button class="btn btn-danger" type="button" @click="logout">Logout</button>
          <button class="btn btn-secondary" type="button" @click="checkLinkStatus">Refresh Stats</button>
        </div>
      </div>

      <div v-if="stats" class="card vrchatapi-stats-section">
        <h3>Account Details</h3>
        <div class="vrchatapi-stats-grid">
          <div class="vrchatapi-stat-card">
            <div class="vrchatapi-stat-value">{{ stats.uploadedAvatars }}</div>
            <div class="vrchatapi-stat-label">Uploaded Avatars</div>
          </div>
          <div class="vrchatapi-stat-card">
            <div class="vrchatapi-stat-value">{{ stats.favoritedAvatars }}</div>
            <div class="vrchatapi-stat-label">Favorited Avatars</div>
          </div>
          <div class="vrchatapi-stat-card">
            <div class="vrchatapi-stat-value">{{ stats.friendsOnline }}</div>
            <div class="vrchatapi-stat-label">Online & Active Friends</div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.vrchatapi-user-id {
  font-size: 0.7em;
  opacity: 0.65;
  margin-top: 3px;
  word-break: break-all;
}

.vrchatapi-stats-section {
  color: inherit;
}

.vrchatapi-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 15px;
}

.vrchatapi-stat-card {
  text-align: center;
  padding: 15px;
  background: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #dee2e6;
}

.vrchatapi-stat-value {
  font-size: 24px;
  font-weight: bold;
  color: #3498db;
}

.vrchatapi-stat-label {
  font-size: 12px;
  opacity: 0.8;
  margin-top: 5px;
}

:global(body.dark-theme .vrchatapi-stats-section) {
  color: #ecf0f1;
}

:global(body.dark-theme .vrchatapi-user-id) {
  color: #95a5a6;
}

:global(body.dark-theme .vrchatapi-stat-card) {
  background: #353535 !important;
  border-color: #454545 !important;
  color: #ecf0f1 !important;
}

:global(body.dark-theme .vrchatapi-stat-value) {
  color: #5dade2;
}

:global(body.dark-theme .vrchatapi-stat-label) {
  color: #bdc3c7;
}
</style>
