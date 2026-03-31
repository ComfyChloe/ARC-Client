import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useElectronAPI } from './useElectronAPI'

export type FeedbackType = 'feature' | 'bug' | 'improvement' | 'other'
export type FeedbackStatus = 'pending' | 'in-progress' | 'completed' | 'rejected'
export type FeedbackSort = 'votes' | 'recent' | 'oldest'

export interface FeedbackItem {
  id: string
  type: FeedbackType
  status: FeedbackStatus
  title: string
  description: string
  votes: number
  version: string
  date: string
  staffResponse?: string
  hasVoted?: boolean
}

export interface FeedbackStats {
  total: number
  feature: number
  bug: number
  improvement: number
  other: number
}

export function useFeedback() {
  const api = useElectronAPI()
  const feedbackList = ref<FeedbackItem[]>([])
  const userStats = ref<FeedbackStats | null>(null)
  const filterType = ref<FeedbackType | 'all'>('all')
  const filterStatus = ref<FeedbackStatus | 'all'>('all')
  const sortBy = ref<FeedbackSort>('votes')
  const submitType = ref<FeedbackType>('feature')
  const submitTitle = ref('')
  const submitDescription = ref('')
  const submitting = ref(false)
  const error = ref<string | null>(null)
  const clientVersion = ref('')

  const filteredList = computed(() => {
    let list = [...feedbackList.value]
    if (filterType.value !== 'all') {
      list = list.filter(f => f.type === filterType.value)
    }
    if (filterStatus.value !== 'all') {
      list = list.filter(f => f.status === filterStatus.value)
    }
    if (sortBy.value === 'votes') {
      list.sort((a, b) => b.votes - a.votes)
    } else if (sortBy.value === 'recent') {
      list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    } else {
      list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    }
    return list
  })

  const descriptionChars = computed(() => submitDescription.value.length)

  async function refreshList() {
    const result = await api.getFeedbackList()
    if (Array.isArray(result)) feedbackList.value = result
  }
  async function refreshStats() {
    const s = await api.getUserFeedbackStats()
    if (s) userStats.value = s
  }
  async function submit() {
    if (!submitTitle.value.trim() || !submitDescription.value.trim()) return
    submitting.value = true
    error.value = null
    const result = await api.sendFeedback({
      type: submitType.value,
      title: submitTitle.value.trim(),
      description: submitDescription.value.trim()
    })
    submitting.value = false
    if (result.error) {
      error.value = result.error
      return
    }
    clearForm()
    await refreshList()
    await refreshStats()
  }
  function clearForm() {
    submitType.value = 'feature'
    submitTitle.value = ''
    submitDescription.value = ''
  }
  async function vote(feedbackId: string) {
    await api.voteFeedback(feedbackId)
    await refreshList()
  }
  function handleFeedbackUpdate(data: any) {
    if (!data?.action) return
    switch (data.action) {
      case 'new-feedback':
        if (data.feedback) feedbackList.value.unshift(data.feedback)
        break
      case 'status-change':
      case 'staff-response':
      case 'type-change':
      case 'vote': {
        const idx = feedbackList.value.findIndex(f => f.id === data.feedbackId)
        if (idx >= 0 && data.feedback) feedbackList.value[idx] = data.feedback
        break
      }
      case 'deleted': {
        const delIdx = feedbackList.value.findIndex(f => f.id === data.feedbackId)
        if (delIdx >= 0) feedbackList.value.splice(delIdx, 1)
        break
      }
    }
  }

  onMounted(async () => {
    const ver = await api.getClientVersion()
    if (ver) clientVersion.value = ver
    await refreshList()
    await refreshStats()
    api.onFeedbackUpdate(handleFeedbackUpdate)
  })
  onUnmounted(() => {
    api.removeAllListeners('feedback-update')
  })

  return {
    feedbackList,
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
    clientVersion,
    descriptionChars,
    submit,
    clearForm,
    vote,
    refreshList
  }
}
