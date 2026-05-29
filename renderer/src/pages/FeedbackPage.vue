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
  vote,
  refreshList
} = useFeedback()

function typeBadgeClass(type: string) {
  return `badge badge-${type}`
}
function statusBadgeClass(status: string) {
  return `badge badge-status-${status}`
}
</script>

<template>
  <div class="page-view">
    <div class="header">
      <h1>ARC Feedback</h1>
      <p>Share your ideas and report issues to help improve ARC</p>
    </div>

    <div v-if="error" class="card">
      <p style="color: #e74c3c;">{{ error }}</p>
    </div>

    <div class="card feedback-section">
      <h3>Submit Feedback</h3>
      <div class="form-group">
        <label for="feedback-type">Feedback Type</label>
        <div class="feedback-type-group" id="feedback-type-group">
          <button
            v-for="t in FEEDBACK_TYPES"
            :key="t"
            type="button"
            class="feedback-type-btn"
            :class="[t, { selected: submitType === t }]"
            :aria-pressed="submitType === t"
            @click="submitType = t"
          >
            {{ t === 'feature' ? 'Feature Request' : t === 'bug' ? 'Bug Report' : t === 'improvement' ? 'Improvement' : 'Other' }}
          </button>
        </div>
      </div>
      <div class="form-group">
        <label for="feedback-title">Title</label>
        <input id="feedback-title" v-model="submitTitle" type="text" maxlength="100" placeholder="Brief summary of your feedback" />
        <small style="color: #666;">Max 100 characters</small>
      </div>
      <div class="form-group">
        <label for="feedback-description">Description</label>
        <textarea id="feedback-description" v-model="submitDescription" class="feedback-textarea" maxlength="2000" rows="6" placeholder="Provide detailed information about your feedback..."></textarea>
        <small style="color: #666;">Max 2000 characters - <span id="feedback-char-count">{{ descriptionChars }}</span>/2000</small>
      </div>
      <div style="display: flex; gap: 10px; margin-top: 15px;">
        <button class="btn btn-primary" type="button" :disabled="submitting || !submitTitle.trim() || !submitDescription.trim()" @click="submit">
          {{ submitting ? 'Submitting...' : 'Submit Feedback' }}
        </button>
        <button class="btn btn-secondary" type="button" @click="clearForm">Clear Form</button>
      </div>
      <div class="feedback-note">
        <small>
          <strong>Note:</strong> Your feedback will be visible to all users (without your username). Staff can update the status and respond to feedback items.
        </small>
      </div>
    </div>

    <div v-if="userStats" class="card">
      <h3>Your Feedback Statistics</h3>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px;">
        <div style="text-align: center; padding: 15px; background: rgba(52, 152, 219, 0.1); border-radius: 8px; border: 1px solid rgba(52, 152, 219, 0.3);">
          <div style="font-size: 24px; font-weight: bold; color: #3498db;">{{ userStats.total }}</div>
          <div style="font-size: 12px; opacity: 0.8; margin-top: 5px;">Total Submitted</div>
        </div>
        <div style="text-align: center; padding: 15px; background: rgba(46, 204, 113, 0.1); border-radius: 8px; border: 1px solid rgba(46, 204, 113, 0.3);">
          <div style="font-size: 24px; font-weight: bold; color: #2ecc71;">{{ userStats.feature }}</div>
          <div style="font-size: 12px; opacity: 0.8; margin-top: 5px;">Feature Requests</div>
        </div>
        <div style="text-align: center; padding: 15px; background: rgba(231, 76, 60, 0.1); border-radius: 8px; border: 1px solid rgba(231, 76, 60, 0.3);">
          <div style="font-size: 24px; font-weight: bold; color: #e74c3c;">{{ userStats.bug }}</div>
          <div style="font-size: 12px; opacity: 0.8; margin-top: 5px;">Bug Reports</div>
        </div>
        <div style="text-align: center; padding: 15px; background: rgba(241, 196, 15, 0.1); border-radius: 8px; border: 1px solid rgba(241, 196, 15, 0.3);">
          <div style="font-size: 24px; font-weight: bold; color: #f1c40f;">{{ userStats.improvement }}</div>
          <div style="font-size: 12px; opacity: 0.8; margin-top: 5px;">Improvements</div>
        </div>
        <div style="text-align: center; padding: 15px; background: rgba(155, 89, 182, 0.1); border-radius: 8px; border: 1px solid rgba(155, 89, 182, 0.3);">
          <div style="font-size: 24px; font-weight: bold; color: #9b59b6;">{{ userStats.other }}</div>
          <div style="font-size: 12px; opacity: 0.8; margin-top: 5px;">Other</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; gap: 10px; flex-wrap: wrap;">
        <h3 style="margin: 0;">Community Feedback</h3>
        <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
          <select v-model="filterType" class="feedback-select">
            <option value="all">All Types</option>
            <option value="feature">Feature Requests</option>
            <option value="bug">Bug Reports</option>
            <option value="improvement">Improvements</option>
            <option value="other">Other</option>
          </select>
          <select v-model="filterStatus" class="feedback-select">
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="in-progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="rejected">Rejected</option>
          </select>
          <select v-model="sortBy" class="feedback-select">
            <option value="votes">Most Votes</option>
            <option value="recent">Most Recent</option>
            <option value="oldest">Oldest First</option>
          </select>
          <button class="btn btn-secondary" type="button" @click="refreshList">Refresh</button>
        </div>
      </div>

      <div v-if="filteredList.length === 0" style="text-align: center; padding: 40px; color: #666;">
        <p>No feedback items found.</p>
      </div>

      <div v-for="item in filteredList" v-else :key="item.id" class="feedback-item">
        <div class="feedback-item-badges">
          <span :class="typeBadgeClass(item.type)">{{ item.type }}</span>
          <span :class="statusBadgeClass(item.status)">{{ item.status }}</span>
          <span v-if="item.version" class="badge badge-version">v{{ item.version }}</span>
        </div>
        <h4 class="feedback-title">{{ item.title }}</h4>
        <p class="feedback-description">{{ item.description }}</p>
        <div v-if="item.staffResponse" class="staff-response">
          <div class="staff-response-title">Staff Response</div>
          <p class="feedback-description">{{ item.staffResponse }}</p>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 15px; gap: 10px; flex-wrap: wrap;">
          <button class="btn btn-primary feedback-vote-btn" type="button" @click="vote(item.id)">
            <span class="vote-arrow">👍</span>
            <span class="vote-count">{{ item.votes }}</span>
            <span class="vote-label">{{ item.hasVoted ? 'Voted' : 'Vote' }}</span>
          </button>
          <div class="feedback-meta">{{ item.date }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
