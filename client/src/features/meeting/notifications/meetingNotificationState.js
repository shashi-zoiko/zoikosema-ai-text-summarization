/* ─────────────────────────────────────────────────────────────────────────
 * Meeting join-screen notification stack — state resolver (pure logic).
 *
 * The join lobby must not decide banner copy / visibility inline in JSX. This
 * module is the single source of truth: given the meeting's trust state it
 * returns an ordered list of banner descriptors (max 3) + the ZoikoTime status,
 * and the detail-panel content behind each CTA.
 *
 * Privacy guardrails (enforced by the copy here): never say surveillance /
 * monitoring / tracking / "break-glass audit"; use protected / permissioned /
 * policy governed / role based. Never promise AI features that are disabled.
 * ──────────────────────────────────────────────────────────────────────── */

/** @typedef {Object} NotificationInputs
 * @property {boolean} confidentialModeEnabled
 * @property {boolean} aiNotesEnabled
 * @property {boolean} recordingEnabled
 * @property {boolean} zoikoTimeConnected
 * @property {boolean} zoikoTimePermittedSignalsEnabled
 * @property {boolean} workspacePolicyManaged
 * @property {boolean} emergencyAccessPolicyAvailable
 * @property {'admin'|'member'|'guest'} userRole
 * @property {boolean} adminOverrideAvailable
 */

export const PANEL = { POLICY: 'policy', TRUST: 'trust', CONNECTION: 'connection' }

/**
 * Map raw meeting + user data to resolver inputs. THIS is the single wiring
 * point: when confidential-mode / AI-notes / recording / ZoikoTime ship as real
 * fields on MeetingOut, read them here (the `??` fallbacks drop away) and the
 * whole stack goes live. Until then we default to the approved "Confidential
 * Mode enforced" design that the lobby currently renders statically.
 * ponytail: defaults centralised here, not scattered across JSX.
 * @returns {NotificationInputs}
 */
export function buildNotificationInputs(meeting, user) {
  return {
    confidentialModeEnabled: meeting?.confidential_mode ?? true,
    aiNotesEnabled: meeting?.ai_notes_enabled ?? false,
    recordingEnabled: meeting?.recording_enabled ?? false,
    zoikoTimeConnected: meeting?.zoiko_time_connected ?? true,
    zoikoTimePermittedSignalsEnabled: meeting?.zoiko_time_permitted_signals ?? true,
    workspacePolicyManaged: meeting?.workspace_policy_managed ?? true,
    emergencyAccessPolicyAvailable: meeting?.emergency_access_available ?? true,
    userRole: user?.is_admin ? 'admin' : user ? 'member' : 'guest',
    adminOverrideAvailable: !!user?.is_admin,
  }
}

/**
 * @param {NotificationInputs} input
 * @returns {{ banners: Array }}
 */
export function resolveMeetingNotifications(input) {
  const banners = []

  // BANNER 1 — Policy / Trust (amber). Emergency-access detail stays OUT of the
  // primary copy; it only surfaces inside the policy panel.
  if (input.workspacePolicyManaged) {
    banners.push({
      id: 'policy',
      tone: 'amber',
      icon: 'shield',
      text: input.confidentialModeEnabled
        ? 'Managed under Zoiko Tech policy. Confidential Mode is enforced for this meeting.'
        : 'Managed under Zoiko Tech policy. Your organization manages this meeting’s settings.',
      textShort: 'Managed under Zoiko Tech policy.',
      cta: { label: 'View policy', panel: PANEL.POLICY },
      tooltip: 'This meeting follows your organization’s security, access and retention settings. Any emergency administrative access is logged and reviewable.',
      ariaLabel: 'Meeting policy notification',
    })
  }

  // BANNER 2 — Confidential Mode (green).
  if (input.confidentialModeEnabled) {
    banners.push({
      id: 'confidential',
      tone: 'green',
      icon: 'secure',
      text: 'Workspace-protected meeting. Zoiko Sema never stores meeting content in Confidential Mode.',
      textShort: 'Workspace-protected. Content isn’t stored.',
      cta: { label: 'Trust Center', panel: PANEL.TRUST },
      tooltip: 'In Confidential Mode, recording, AI notes and stored meeting content are disabled unless your organization has explicitly configured otherwise.',
      ariaLabel: 'Confidential mode notification',
    })
  }

  // BANNER 3 — AI + ZoikoTime status (purple). Always present.
  banners.push(resolveAiZoikoBanner(input))

  return { banners: banners.slice(0, 3) } // spec: max 3 banners
}

function resolveAiZoikoBanner(input) {
  const base = {
    id: 'ai-zoiko',
    tone: 'purple',
    icon: 'ai',
    cta: { label: 'Connection details', panel: PANEL.CONNECTION },
    tooltip: 'ZoikoTime is connected for this workspace. In Confidential Mode, Sema does not store meeting content or generate AI notes. Only permitted meeting signals such as meeting status, participant presence, policy state and workspace context may be shared according to organization settings.',
    ariaLabel: 'AI and ZoikoTime status notification',
  }

  // CASE 4 — permission/connection issue takes priority over everything.
  if (input.zoikoTimeConnected && !input.zoikoTimePermittedSignalsEnabled) {
    return {
      ...base,
      text: 'ZoikoTime connection needs review. Some permitted signals may not sync until settings are updated.',
      textShort: 'ZoikoTime connection needs review.',
      cta: { label: 'Review settings', panel: PANEL.CONNECTION },
      status: { label: 'Connection needs review', tone: 'amber' },
    }
  }
  // CASE 1 — confidential ON, AI off, ZoikoTime connected.
  if (input.confidentialModeEnabled && !input.aiNotesEnabled && input.zoikoTimeConnected) {
    return {
      ...base,
      text: 'AI follow-ups are paused in Confidential Mode. ZoikoTime connection remains limited to permitted meeting signals.',
      textShort: 'AI follow-ups paused. ZoikoTime connected for permitted signals.',
      status: { label: 'Connected to ZoikoTime', tone: 'green' },
    }
  }
  // CASE 2 — confidential OFF, AI on, ZoikoTime connected.
  if (!input.confidentialModeEnabled && input.aiNotesEnabled && input.zoikoTimeConnected) {
    return {
      ...base,
      text: 'Sema will summarize this meeting, extract action items and connect permitted follow-ups to ZoikoTime.',
      textShort: 'Sema will summarize and connect follow-ups to ZoikoTime.',
      cta: { label: 'Manage settings', panel: PANEL.CONNECTION },
      status: { label: 'Connected to ZoikoTime', tone: 'green' },
    }
  }
  // CASE 3 — confidential ON, ZoikoTime not connected.
  if (input.confidentialModeEnabled && !input.zoikoTimeConnected) {
    return {
      ...base,
      text: 'AI follow-ups are paused in Confidential Mode. ZoikoTime is not connected for this meeting.',
      textShort: 'AI follow-ups paused. ZoikoTime not connected.',
      cta: { label: 'Learn more', panel: PANEL.CONNECTION },
      status: { label: 'Not connected', tone: 'muted' },
    }
  }
  // Fallback — AI off & not confidential. Never promise disabled AI features.
  return {
    ...base,
    text: input.zoikoTimeConnected
      ? 'AI follow-ups are off for this meeting. ZoikoTime is connected for permitted meeting signals.'
      : 'AI follow-ups are off for this meeting. ZoikoTime is not connected.',
    textShort: input.zoikoTimeConnected ? 'AI follow-ups off. ZoikoTime connected.' : 'AI follow-ups off. ZoikoTime not connected.',
    cta: { label: input.zoikoTimeConnected ? 'Connection details' : 'Learn more', panel: PANEL.CONNECTION },
    status: { label: input.zoikoTimeConnected ? 'Connected to ZoikoTime' : 'Not connected', tone: input.zoikoTimeConnected ? 'green' : 'muted' },
  }
}

/**
 * Full detail behind a banner CTA. This is where the fields that must NOT sit in
 * a banner live — the permitted / not-shared signal lists, emergency-access copy.
 * @param {'policy'|'trust'|'connection'} panel
 * @param {NotificationInputs} input
 */
export function getPanelContent(panel, input) {
  if (panel === PANEL.POLICY) {
    return {
      title: 'Meeting policy',
      tone: 'amber',
      icon: 'shield',
      sections: [
        { body: 'This meeting follows your organization’s security, access and retention settings.' },
        {
          body: input.confidentialModeEnabled
            ? 'Confidential Mode is enforced: recording, AI notes and stored meeting content are disabled unless your organization has explicitly configured otherwise.'
            : 'Your organization manages recording, AI notes and retention settings for this meeting.',
        },
        ...(input.emergencyAccessPolicyAvailable
          ? [{ heading: 'Emergency administrative access', body: 'Any emergency administrative access is policy governed, role based, and logged for later review.' }]
          : []),
      ],
    }
  }
  if (panel === PANEL.TRUST) {
    return {
      title: 'Trust Center',
      tone: 'green',
      icon: 'secure',
      sections: [
        { body: 'Meeting content stays protected and is not stored by Sema.' },
        { body: 'In Confidential Mode, recording, AI notes and stored meeting content are disabled unless your organization has explicitly configured otherwise.' },
      ],
    }
  }
  // CONNECTION
  return {
    title: 'Connection details',
    tone: 'purple',
    icon: 'ai',
    sections: [
      { body: input.zoikoTimeConnected ? 'ZoikoTime is connected for this workspace.' : 'ZoikoTime is not connected for this meeting.' },
      ...(input.confidentialModeEnabled
        ? [{ body: 'In Confidential Mode, Sema does not store meeting content or generate AI notes.' }]
        : []),
      { heading: 'Permitted signals', list: ['Meeting status', 'Participant presence', 'Policy state', 'Workspace context'] },
      ...(input.confidentialModeEnabled
        ? [{ heading: 'Not shared in Confidential Mode', negative: true, list: ['Meeting content', 'Transcripts', 'Recordings', 'AI summaries'] }]
        : []),
    ],
  }
}
