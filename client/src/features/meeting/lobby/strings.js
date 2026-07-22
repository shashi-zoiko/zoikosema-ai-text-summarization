import { registerMessages } from '../../../lib/i18n.js'

/**
 * Pre-join "Meeting Join Device & Access Panel" localization fixture.
 *
 * A DATA fixture for the shared i18n system (same pattern as
 * features/meeting/more/strings.js) — not a second localization system. All
 * new lobby copy is keyed `meeting.lobby.*` so it lives in one place instead of
 * scattered string literals in JSX. English is the base; `t()` already falls
 * back to `en`, so other locales register later without touching consumers.
 *
 * Legal/trust copy guardrails (mirror meetingNotificationState.js): never imply
 * recording / AI summarizing / stored transcript when policy disables them, and
 * never imply "anyone can enter".
 */

export const LOBBY_MESSAGES_EN = {
  // Region / structure
  'meeting.lobby.region': 'Meeting join controls',
  'meeting.lobby.readiness.ready': 'Ready to join',
  'meeting.lobby.readiness.joining': 'Joining…',
  'meeting.lobby.readiness.waiting': 'Waiting for host',

  // Primary CTA
  'meeting.lobby.join': 'Join meeting',
  'meeting.lobby.join.retry': 'Retry join',
  'meeting.lobby.join.timeout': 'Could not join. Check your connection and try again.',

  // Join modes
  'meeting.lobby.mode.normal': 'Join meeting',
  'meeting.lobby.mode.audio': 'Audio only',
  'meeting.lobby.mode.audio.hint': 'Join with your camera off.',
  'meeting.lobby.mode.present': 'Present',
  'meeting.lobby.mode.dialin': 'Dial in',
  'meeting.lobby.mode.unavailable': 'Not available for this meeting.',

  // Device panel
  'meeting.lobby.device.microphone': 'Microphone',
  'meeting.lobby.device.camera': 'Camera',
  'meeting.lobby.device.speaker': 'Speaker',
  'meeting.lobby.device.microphone.fallback': 'Default microphone',
  'meeting.lobby.device.camera.fallback': 'Default camera',
  'meeting.lobby.device.speaker.fallback': 'Default speaker',
  'meeting.lobby.device.test': 'Test',
  'meeting.lobby.device.test.audio': 'Test audio',
  'meeting.lobby.device.preview': 'Preview',
  'meeting.lobby.device.speaker.unsupported': 'Speaker selection isn’t supported on this browser.',
  'meeting.lobby.device.speaker.playing': 'Playing test tone…',

  // Security status tiles
  'meeting.lobby.tile.confidential': 'Confidential Mode',
  'meeting.lobby.tile.confidential.active': 'Active',
  'meeting.lobby.tile.confidential.off': 'Standard',
  'meeting.lobby.tile.ai': 'AI notes',
  'meeting.lobby.tile.ai.enabled': 'On',
  'meeting.lobby.tile.ai.off': 'Off',
  'meeting.lobby.tile.ai.off_confidential': 'Off in Confidential Mode',
  'meeting.lobby.tile.ai.off_admin': 'Off by policy',
  'meeting.lobby.tile.ai.unavailable': 'Unavailable',
  'meeting.lobby.tile.recording': 'Recording',
  'meeting.lobby.tile.recording.on': 'On',
  'meeting.lobby.tile.recording.off': 'Off',
  'meeting.lobby.tile.recording.blocked': 'Off',
  'meeting.lobby.tile.guests': 'Guests',
  'meeting.lobby.tile.guests.allowed': 'Allowed',
  'meeting.lobby.tile.guests.off': 'Members only',
  'meeting.lobby.tile.admission': 'Admission',
  'meeting.lobby.tile.admission.not_required': 'Not required',
  'meeting.lobby.tile.admission.host_approval': 'Host approval',
  'meeting.lobby.tile.admission.external_lobby': 'External lobby',
  'meeting.lobby.tile.admission.admin_controlled': 'Admin controlled',

  // Connection (ZoikoTime + network)
  'meeting.lobby.connection.connected': 'Connected',
  'meeting.lobby.connection.limited': 'Limited signals',
  'meeting.lobby.connection.disconnected': 'Disconnected',
  'meeting.lobby.connection.details': 'Connection details',
  'meeting.lobby.network.checking': 'Checking your connection…',
  'meeting.lobby.network.strong': 'Strong connection',
  'meeting.lobby.network.good': 'Good connection',
  'meeting.lobby.network.weak': 'Limited connection',
  'meeting.lobby.network.hd': 'HD available',
  'meeting.lobby.network.sd': 'Standard quality',

  // Invite
  'meeting.lobby.invite.copy': 'Copy invite link',
  'meeting.lobby.invite.copied': 'Link copied',
  'meeting.lobby.invite.note': 'Admission rules still apply.',
}

let _registered = false

/** Idempotently register the lobby strings into the shared i18n `en` locale. */
export function registerLobbyStrings() {
  if (_registered) return
  registerMessages('en', LOBBY_MESSAGES_EN)
  _registered = true
}
