// ====
// FeedbackPage state factory — sibling script module for FeedbackPage.vue.
// Owns the feedback type constant list and badge class helpers. All form
// and list state lives in composables/useFeedback.ts.
// Call createFeedbackPageState() once from <script setup>.
// ====
import { useFeedback } from '../composables/useFeedback'
import type { FeedbackType } from '../composables/useFeedback'

const FEEDBACK_TYPES: FeedbackType[] = ['feature', 'bug', 'improvement', 'other']

export function createFeedbackPageState() {
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
  return {
    FEEDBACK_TYPES,
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
    refreshList,
    typeBadgeClass,
    statusBadgeClass
  }
}
