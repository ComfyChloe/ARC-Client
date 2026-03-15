<script setup lang="ts">
import { useFeedback } from '../composables/useFeedback'
import type { FeedbackType } from '../composables/useFeedback'

const FEEDBACK_TYPES: FeedbackType[] = ['feature', 'bug', 'improvement', 'other']

const {
  filteredList,
  userStats,
  filterType,
  filterStatus,
  sortBy,
  submitType,
  submitTitle,
  submitDescription,
  submitting,
  error,
  descriptionChars,
  submit,
  clearForm,
  vote
} = useFeedback()

function typeBadgeClass(type: string) {
  return `badge badge-${type}`
}
function statusBadgeClass(status: string) {
  return `badge badge-status-${status}`
}
</script>

<template>
  <div class="page">
    <h2>Feedback</h2>

    <div v-if="error" class="alert alert-danger">{{ error }}</div>

    <!-- Submit Form -->
    <div class="card">
      <h3>Submit Feedback</h3>
      <div class="form-group">
        <label>Type</label>
        <div class="button-row">
          <button
            v-for="t in FEEDBACK_TYPES"
            :key="t"
            :class="['btn-type', { active: submitType === t }]"
            @click="submitType = t"
          >
            {{ t }}
          </button>
        </div>
      </div>
      <div class="form-group">
        <label>Title (max 100)</label>
        <input type="text" v-model="submitTitle" maxlength="100" placeholder="Brief summary" />
      </div>
      <div class="form-group">
        <label>Description ({{ descriptionChars }}/2000)</label>
        <textarea v-model="submitDescription" maxlength="2000" rows="4" placeholder="Describe your feedback..."></textarea>
      </div>
      <div class="button-row">
        <button @click="submit" :disabled="submitting || !submitTitle.trim() || !submitDescription.trim()">
          {{ submitting ? 'Submitting...' : 'Submit' }}
        </button>
        <button class="btn-secondary" @click="clearForm">Clear</button>
      </div>
    </div>

    <!-- Stats -->
    <div v-if="userStats" class="card">
      <h3>Your Stats</h3>
      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-value">{{ userStats.total }}</span>
          <span class="stat-label">Total</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ userStats.feature }}</span>
          <span class="stat-label">Features</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ userStats.bug }}</span>
          <span class="stat-label">Bugs</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">{{ userStats.improvement }}</span>
          <span class="stat-label">Improvements</span>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="card">
      <div class="filter-row">
        <div class="form-group">
          <label>Type</label>
          <select v-model="filterType">
            <option value="all">All</option>
            <option v-for="t in FEEDBACK_TYPES" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div class="form-group">
          <label>Status</label>
          <select v-model="filterStatus">
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="in-progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div class="form-group">
          <label>Sort</label>
          <select v-model="sortBy">
            <option value="votes">Most Votes</option>
            <option value="recent">Most Recent</option>
            <option value="oldest">Oldest</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Feedback List -->
    <div v-if="filteredList.length === 0" class="card">
      <p class="text-muted">No feedback items found.</p>
    </div>
    <div v-for="item in filteredList" :key="item.id" class="card feedback-item">
      <div class="feedback-header">
        <span :class="typeBadgeClass(item.type)">{{ item.type }}</span>
        <span :class="statusBadgeClass(item.status)">{{ item.status }}</span>
        <span v-if="item.version" class="badge">v{{ item.version }}</span>
      </div>
      <h4>{{ item.title }}</h4>
      <p>{{ item.description }}</p>
      <div v-if="item.staffResponse" class="staff-response">
        <strong>Staff Response:</strong>
        <p>{{ item.staffResponse }}</p>
      </div>
      <div class="feedback-footer">
        <button class="btn-sm" :class="{ active: item.hasVoted }" @click="vote(item.id)">
          👍 {{ item.votes }}
        </button>
        <span class="text-muted">{{ item.date }}</span>
      </div>
    </div>
  </div>
</template>
