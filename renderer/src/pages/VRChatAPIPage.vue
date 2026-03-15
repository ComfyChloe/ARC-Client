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
  <div class="page">
    <h2>VRChat API</h2>

    <!-- Error -->
    <div v-if="error" class="alert alert-danger">{{ error }}</div>

    <!-- 2FA Modal -->
    <div v-if="isPending2FA" class="card">
      <h3>Two-Factor Authentication</h3>
      <p>
        Method: {{ status.twoFactorMethods.includes('emailOtp') ? 'Email Code' : 'Authenticator App' }}
      </p>
      <div class="form-group">
        <label>Verification Code</label>
        <input type="text" v-model="twoFactorCode" placeholder="Enter code" maxlength="6" @keyup.enter="verify2FA" />
      </div>
      <div class="button-row">
        <button @click="verify2FA" :disabled="loading || !twoFactorCode">Verify</button>
        <button class="btn-secondary" @click="cancel2FA">Cancel</button>
      </div>
    </div>

    <!-- Login Form -->
    <div v-else-if="!isAuthenticated" class="card">
      <h3>Login</h3>
      <div class="form-group">
        <label>Username</label>
        <input type="text" v-model="loginUsername" placeholder="Username or email" @keyup.enter="login" />
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" v-model="loginPassword" placeholder="Password" @keyup.enter="login" />
      </div>
      <button @click="login" :disabled="loading || !loginUsername || !loginPassword">
        {{ loading ? 'Logging in...' : 'Login' }}
      </button>
    </div>

    <!-- Authenticated View -->
    <template v-else>
      <div class="card">
        <h3>Logged In</h3>
        <div v-if="status.currentUser" class="user-info">
          <strong>{{ status.currentUser.displayName }}</strong>
          <span class="badge">{{ status.currentUser.id }}</span>
        </div>
        <p v-if="status.pipelineConnected" class="text-success">Pipeline Connected</p>
        <p v-else class="text-muted">Pipeline Disconnected</p>
        <button class="btn-danger" @click="logout">Logout</button>
      </div>

      <!-- Stats -->
      <div v-if="stats" class="card">
        <h3>Stats</h3>
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-value">{{ stats.uploadedAvatars }}</span>
            <span class="stat-label">Uploaded Avatars</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ stats.favoritedAvatars }}</span>
            <span class="stat-label">Favorited Avatars</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ stats.friendsOnline }}</span>
            <span class="stat-label">Friends Online</span>
          </div>
        </div>
      </div>

      <!-- VRChat Linking -->
      <div class="card">
        <h3>Link to ARC</h3>
        <div v-if="linkStatus === 'linked'" class="text-success">
          ✅ VRChat account linked to ARC
        </div>
        <div v-else>
          <p>Link your VRChat account to your ARC server account.</p>
          <div class="button-row">
            <button @click="shareWithARC">Link VRChat Account</button>
            <button class="btn-secondary" @click="checkLinkStatus">Check Status</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
