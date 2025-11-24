// ARC Feedback UI Management
let feedbackList = [];
let filteredFeedbackList = [];
let userFeedbackStats = {
    total: 0,
    feature: 0,
    bug: 0,
    improvement: 0,
    other: 0
};
// Initialize feedback character counter
document.addEventListener('DOMContentLoaded', () => {
    const descriptionField = document.getElementById('feedback-description');
    if (descriptionField) {
        descriptionField.addEventListener('input', updateFeedbackCharCount);
    }
});
function updateFeedbackCharCount() {
    const description = document.getElementById('feedback-description').value;
    const charCount = document.getElementById('feedback-char-count');
    if (charCount) {
        charCount.textContent = description.length;
    }
}
async function submitFeedback() {
    const type = document.getElementById('feedback-type').value;
    const title = document.getElementById('feedback-title').value.trim();
    const description = document.getElementById('feedback-description').value.trim();
    // Validation
    if (!title) {
        debugLog('Please enter a title for your feedback', 'error');
        return;
    }
    if (!description) {
        debugLog('Please enter a description for your feedback', 'error');
        return;
    }
    if (title.length > 100) {
        debugLog('Title must be 100 characters or less', 'error');
        return;
    }
    if (description.length > 2000) {
        debugLog('Description must be 2000 characters or less', 'error');
        return;
    }
    if (!isConnected || !isAuthenticated) {
        debugLog('You must be connected and authenticated to submit feedback', 'error');
        return;
    }
    // Disable submit button during submission
    const submitBtn = document.getElementById('submit-feedback-btn');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    try {
        // Get client version from package.json or define it
        const clientVersion = await window.electronAPI.getClientVersion();
        const feedbackData = {
            type,
            title,
            description,
            clientVersion,
            timestamp: Date.now()
        };
        // Send feedback via WebSocket
        await window.electronAPI.sendFeedback(feedbackData);
        debugLog('Feedback submitted successfully!', 'info');
        // Clear form
        clearFeedbackForm();
        // Refresh feedback list and stats
        await refreshFeedbackList();
        await updateUserFeedbackStats();
    } catch (error) {
        console.error('Error submitting feedback:', error);
        debugLog('Failed to submit feedback: ' + error.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}
function clearFeedbackForm() {
    document.getElementById('feedback-type').value = 'feature';
    document.getElementById('feedback-title').value = '';
    document.getElementById('feedback-description').value = '';
    updateFeedbackCharCount();
}
async function refreshFeedbackList() {
    try {
        const feedback = await window.electronAPI.getFeedbackList();
        feedbackList = feedback || [];
        filterFeedback();
        await updateUserFeedbackStats();
        debugLog(`Loaded ${feedbackList.length} feedback items`, 'info');
    } catch (error) {
        console.error('Error loading feedback list:', error);
        debugLog('Failed to load feedback: ' + error.message, 'error');
    }
}
function filterFeedback() {
    const typeFilter = document.getElementById('feedback-filter-type').value;
    const statusFilter = document.getElementById('feedback-filter-status').value;
    filteredFeedbackList = feedbackList.filter(item => {
        const matchesType = typeFilter === 'all' || item.type === typeFilter;
        const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
        return matchesType && matchesStatus;
    });
    sortFeedback();
}
function sortFeedback() {
    const sortBy = document.getElementById('feedback-sort').value;
    switch (sortBy) {
        case 'votes':
            filteredFeedbackList.sort((a, b) => (b.votes || 0) - (a.votes || 0));
            break;
        case 'recent':
            filteredFeedbackList.sort((a, b) => b.timestamp - a.timestamp);
            break;
        case 'oldest':
            filteredFeedbackList.sort((a, b) => a.timestamp - b.timestamp);
            break;
    }
    renderFeedbackList();
}
function renderFeedbackList() {
    const container = document.getElementById('feedback-list-container');
    if (filteredFeedbackList.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #666;">
                <p>No feedback items found matching your filters.</p>
            </div>
        `;
        return;
    }
    container.innerHTML = filteredFeedbackList.map(item => createFeedbackItemHTML(item)).join('');
}
function createFeedbackItemHTML(item) {
    const typeColors = {
        feature: '#3498db',
        bug: '#e74c3c',
        improvement: '#f1c40f',
        other: '#9b59b6'
    };
    const statusColors = {
        pending: '#95a5a6',
        'in-progress': '#f39c12',
        completed: '#27ae60',
        rejected: '#c0392b'
    };
    const statusLabels = {
        pending: 'Pending',
        'in-progress': 'In Progress',
        completed: 'Completed',
        rejected: 'Rejected'
    };
    const typeLabels = {
        feature: 'Feature Request',
        bug: 'Bug Report',
        improvement: 'Improvement',
        other: 'Other'
    };
    const userHasVoted = item.voters && item.voters.includes(currentUser?.username);
    const date = new Date(item.timestamp).toLocaleDateString();

    return `
        <div class="feedback-item" data-id="${item.id}" style="margin-bottom: 15px; padding: 15px; border: 1px solid #e0e0e0; border-radius: 8px; background: white;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                <div style="flex: 1;">
                    <div style="display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;">
                        <span style="padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; background: ${typeColors[item.type]}; color: white;">
                            ${typeLabels[item.type]}
                        </span>
                        <span style="padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; background: ${statusColors[item.status]}; color: white;">
                            ${statusLabels[item.status]}
                        </span>
                        ${item.clientVersion ? `<span style="padding: 4px 10px; border-radius: 4px; font-size: 11px; background: #ecf0f1; color: #7f8c8d;">v${item.clientVersion}</span>` : ''}
                    </div>
                    <h4 style="margin: 0 0 8px 0; color: #2c3e50;">${escapeHtml(item.title)}</h4>
                    <p style="margin: 0; color: #666; font-size: 14px; line-height: 1.5;">${escapeHtml(item.description)}</p>
                    <div style="margin-top: 10px; font-size: 12px; color: #999;">
                        Submitted ${date}${item.staffResponse ? ' • <strong style="color: #e74c3c;">Staff Response Available</strong>' : ''}
                    </div>
                </div>
                <div style="text-align: center; margin-left: 20px;">
                    <button 
                        class="btn ${userHasVoted ? 'btn-success' : 'btn-secondary'}" 
                        onclick="voteFeedback('${item.id}')" 
                        ${userHasVoted ? 'disabled' : ''}
                        style="padding: 8px 16px; min-width: 80px; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                        <span style="font-size: 18px;">▲</span>
                        <span style="font-weight: bold;">${item.votes || 0}</span>
                        <span style="font-size: 10px;">${userHasVoted ? 'VOTED' : 'VOTE'}</span>
                    </button>
                </div>
            </div>
            ${item.staffResponse ? `
                <div style="margin-top: 15px; padding: 12px; background: #f8f9fa; border-left: 3px solid #3498db; border-radius: 4px;">
                    <div style="font-size: 11px; font-weight: 600; color: #3498db; margin-bottom: 4px;">STAFF RESPONSE</div>
                    <p style="margin: 0; color: #2c3e50; font-size: 13px;">${escapeHtml(item.staffResponse)}</p>
                </div>
            ` : ''}
        </div>
    `;
}
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}
async function voteFeedback(feedbackId) {
    if (!isConnected || !isAuthenticated) {
        debugLog('You must be connected and authenticated to vote', 'error');
        return;
    }
    try {
        await window.electronAPI.voteFeedback(feedbackId);
        debugLog('Vote submitted successfully', 'info');
        // Update local feedback list
        const item = feedbackList.find(f => f.id === feedbackId);
        if (item) {
            item.votes = (item.votes || 0) + 1;
            if (!item.voters) item.voters = [];
            item.voters.push(currentUser.username);
            filterFeedback(); // Re-render
        }
    } catch (error) {
        console.error('Error voting on feedback:', error);
        debugLog('Failed to vote: ' + error.message, 'error');
    }
}
async function updateUserFeedbackStats() {
    try {
        const stats = await window.electronAPI.getUserFeedbackStats();
        userFeedbackStats = stats || { total: 0, feature: 0, bug: 0, improvement: 0, other: 0 };
        // Update UI
        document.getElementById('stats-total').textContent = userFeedbackStats.total || 0;
        document.getElementById('stats-features').textContent = userFeedbackStats.feature || 0;
        document.getElementById('stats-bugs').textContent = userFeedbackStats.bug || 0;
        document.getElementById('stats-improvements').textContent = userFeedbackStats.improvement || 0;
        document.getElementById('stats-other').textContent = userFeedbackStats.other || 0;
    } catch (error) {
        console.error('Error loading feedback stats:', error);
    }
}
// Initialize feedback when view is shown
async function showARCFeedbackView() {
    const views = ['main-view', 'settings-view', 'vosk-view', 'arcfeedback-view', 'chatbox-view', 'vrchatapi-view', 'osc-leash-view', 'auto-inviter-view', 'Hyperate-view', 'logs-view', 'osc-view'];
    views.forEach(viewId => {
        const view = document.getElementById(viewId);
        if (view) {
            view.style.display = 'none';
            view.classList.remove('fade-in');
        }
    });
    const feedbackView = document.getElementById('arcfeedback-view');
    if (feedbackView) {
        feedbackView.style.display = 'block';
        setTimeout(() => feedbackView.classList.add('fade-in'), 10);
    }
    // Update navigation button states
    updateNavigationButtons('nav-arcfeedback');
    // Load feedback data
    if (isConnected && isAuthenticated) {
        await refreshFeedbackList();
        await updateUserFeedbackStats();
    } else {
        debugLog('Connect and authenticate to view and submit feedback', 'info');
    }
}
// Set up feedback update listener
if (typeof window !== 'undefined' && window.electronAPI) {
    window.electronAPI.onFeedbackUpdate((data) => {
        console.log('Feedback update received:', data);
        // Handle different update types
        if (data.action === 'new-feedback') {
            // Add new feedback to list
            feedbackList.unshift(data.feedback);
            filterFeedback();
            debugLog('New feedback submitted', 'info');
        } else if (data.action === 'status-change' || data.action === 'staff-response') {
            // Update existing feedback
            const index = feedbackList.findIndex(f => f.id === data.feedbackId);
            if (index !== -1) {
                if (data.status) feedbackList[index].status = data.status;
                if (data.staffResponse) feedbackList[index].staffResponse = data.staffResponse;
                filterFeedback();
                debugLog(`Feedback ${data.feedbackId} updated`, 'info');
            }
        } else if (data.action === 'type-change') {
            // Update feedback type
            const index = feedbackList.findIndex(f => f.id === data.feedbackId);
            if (index !== -1) {
                feedbackList[index].type = data.type;
                filterFeedback();
                // Refresh user stats since type changed
                updateUserFeedbackStats();
            }
        } else if (data.action === 'vote') {
            // Update vote count
            const index = feedbackList.findIndex(f => f.id === data.feedbackId);
            if (index !== -1) {
                feedbackList[index].votes = data.votes;
                filterFeedback();
            }
        } else if (data.action === 'deleted') {
            // Remove feedback from list
            const index = feedbackList.findIndex(f => f.id === data.feedbackId);
            if (index !== -1) {
                feedbackList.splice(index, 1);
                filterFeedback();
                // Refresh user stats since feedback was deleted
                updateUserFeedbackStats();
                debugLog('Feedback deleted', 'info');
            }
        }
    });
}
