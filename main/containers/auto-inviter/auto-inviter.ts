/**
 * Auto-Inviter Container
 *
 * Placeholder service. Will eventually auto-accept VRChat invite
 * requests from a configurable allow-list (per-VRChat-user, per-
 * group, per-world, etc.) so the local user doesn't have to
 * manually click "Accept" on incoming invites while AFK.
 *
 * All methods are stubs that return `{ success: false, error:
 * 'Feature not yet implemented' }`. Future passes will wire this
 * up against the existing VRChat API container (mirroring how
 * AutoStatus reads `vrchatApiContainer.getStatus().currentUser.id`
 * for the local user's usrId).
 *
 * Integration points already available when implementation begins:
 *   - VRChat API: `vrchatApiContainer.getNotificationV2S` returns
 *     incoming invite notifications with `senderUserId`,
 *     `receiverUserId`, `linkedGroupId`, etc.
 *   - VRChat API: `vrchatApiContainer.getUserGroupInstances(...)` /
 *     `getWorld(...)` for resolving allow-list names to ids.
 *   - clientUpdate pipeline: the local user's instance joins are
 *     already being emitted to ARC-OSC, so a future
 *     "invite-while-in-instance" mode is straightforward to bolt on.
 *   - State scheduler: existing AutoStatus + ScheduleService have
 *     the rate-limit + cooldown patterns to copy for invite
 *     throttling.
 */
import debug from '../../services/debugger'

interface InviteRule {
    id: string
    name: string
    enabled: boolean
    // Who is allowed to send us invites this rule matches.
    // Free-form for now (could be usrId, groupId, worldId, etc.)
    matchValue: string
    matchKind: 'user' | 'group' | 'world'
    // Optional: only auto-accept invites for a specific instance
    // type (e.g. group+, friends+).
    matchInstanceType?: string | null
    // Optional: cooldown in seconds between accepted invites from
    // the same sender (prevents invite spam).
    cooldownSeconds: number
}

interface InviteRuleInput {
    name?: string
    enabled?: boolean
    matchValue?: string
    matchKind?: 'user' | 'group' | 'world'
    matchInstanceType?: string | null
    cooldownSeconds?: number
}

class AutoInviter {
    rules: InviteRule[]
    enabled: boolean
    lastFetch: number | null
    onRulesUpdate: ((rules: InviteRule[]) => void) | null

    constructor() {
        this.rules = []
        this.enabled = false
        this.lastFetch = null
        this.onRulesUpdate = null
    }

    /**
     * Initialize the Auto-Inviter service.
     */
    async init(): Promise<{ success: boolean; error?: string }> {
        try {
            // Placeholder for future implementation. Future passes
            // will:
            //   - subscribe to VRChat API notification-v2 events
            //     for incoming invites
            //   - load allow-list rules from app settings
            //   - throttle via the per-sender cooldown field
            debug.info('[AutoInviter] Service initialized (placeholder)')
            return { success: true }
        } catch (error) {
            debug.error(`[AutoInviter] Failed to initialize: ${(error as Error).message}`, {
                stack: (error as Error).stack
            })
            return { success: false, error: (error as Error).message }
        }
    }

    /**
     * Return current rules + container status. Used by the
     * renderer-side AutoInviter page for state hydration.
     */
    getStatus(): { rules: InviteRule[]; enabled: boolean; lastFetch: number | null } {
        return {
            rules: JSON.parse(JSON.stringify(this.rules)) as InviteRule[],
            enabled: this.enabled,
            lastFetch: this.lastFetch,
        }
    }

    /**
     * Append a new rule to the allow-list.
     */
    async addRule(rule: InviteRuleInput): Promise<{ success: boolean; error?: string; rule?: InviteRule }> {
        try {
            // Placeholder for future implementation.
            debug.info('[AutoInviter] addRule called (placeholder)')
            return { success: false, error: 'Feature not yet implemented' }
        } catch (error) {
            debug.error(`[AutoInviter] addRule failed: ${(error as Error).message}`, {
                stack: (error as Error).stack
            })
            return { success: false, error: (error as Error).message }
        }
    }

    /**
     * Patch an existing rule.
     */
    async updateRule(ruleId: string, updates: InviteRuleInput): Promise<{ success: boolean; error?: string }> {
        try {
            // Placeholder for future implementation.
            debug.info('[AutoInviter] updateRule called (placeholder)')
            return { success: false, error: 'Feature not yet implemented' }
        } catch (error) {
            debug.error(`[AutoInviter] updateRule failed: ${(error as Error).message}`, {
                stack: (error as Error).stack
            })
            return { success: false, error: (error as Error).message }
        }
    }

    /**
     * Remove a rule from the allow-list.
     */
    async deleteRule(ruleId: string): Promise<{ success: boolean; error?: string }> {
        try {
            // Placeholder for future implementation.
            debug.info('[AutoInviter] deleteRule called (placeholder)')
            return { success: false, error: 'Feature not yet implemented' }
        } catch (error) {
            debug.error(`[AutoInviter] deleteRule failed: ${(error as Error).message}`, {
                stack: (error as Error).stack
            })
            return { success: false, error: (error as Error).message }
        }
    }
}

export default AutoInviter
export type { InviteRule, InviteRuleInput }