import { buildNotificationInputs } from '../notifications/meetingNotificationState.js'
import { t } from '../../../lib/i18n.js'

/* ─────────────────────────────────────────────────────────────────────────
 * Pre-join security/access view-model.
 *
 * Single source of truth for the lobby's security status tiles. It does NOT
 * invent a parallel policy layer — it reuses `buildNotificationInputs`, the
 * same `??`-defaulted contract the notification stack already renders from, so
 * the tiles and the trust banners stay consistent and go live together the day
 * real fields land on MeetingOut.
 *
 * Everything here is DERIVED from real meeting fields (or the centralized
 * contract defaults) — no hardcoded literal values in JSX. E2EE is implicit and
 * always-on server-side (media-token `e2ee_key`), which is why recording is
 * treated as blocked-by-policy rather than merely "off".
 *
 * Enums match the spec exactly:
 *   ai:         enabled | off_confidential | off_admin | unavailable
 *   recording:  off | on | blocked_by_policy
 *   admission:  not_required | host_approval | external_lobby | admin_controlled
 *   connection: connected | limited | disconnected
 * ──────────────────────────────────────────────────────────────────────── */

const TONE = { GOOD: 'good', WARN: 'warn', ACCENT: 'accent', MUTED: 'muted' }

/**
 * @param {object|null} meeting  MeetingOut / PublicMeetingOut (or null while loading)
 * @param {{ isGuest?: boolean, isHost?: boolean, user?: object|null }} ctx
 */
export function deriveMeetingAccess(meeting, ctx = {}) {
  const { isGuest = false, isHost = false, user = null } = ctx
  const input = buildNotificationInputs(meeting, user)

  const confidential = input.confidentialModeEnabled

  // AI notes — never promise a disabled feature. Confidential wins.
  const ai = confidential
    ? 'off_confidential'
    : input.aiNotesEnabled
      ? 'enabled'
      : 'off'

  // Recording — E2EE is always on, so egress can't capture frames: effectively
  // blocked unless a real recording_enabled flag ever says otherwise.
  const recording = input.recordingEnabled ? 'on' : confidential ? 'blocked_by_policy' : 'off'

  // Admission — derived from the real gating fields on the meeting payload.
  const waitingRoom = !!meeting?.waiting_room_enabled
  const locked = !!meeting?.locked
  let admission
  if (isHost) admission = 'not_required'
  else if (locked) admission = 'admin_controlled'
  else if (waitingRoom && isGuest) admission = 'external_lobby'
  else if (waitingRoom) admission = 'host_approval'
  else admission = 'not_required'

  // Guests — no external-guest count exists server-side; expose the real
  // capability instead of a fabricated number.
  const guestsAllowed = meeting?.guests_enabled !== false

  // ZoikoTime connection — connected, but limited to permitted signals under
  // Confidential Mode (never implies content sharing).
  let connection
  if (!input.zoikoTimeConnected) connection = 'disconnected'
  else if (confidential || !input.zoikoTimePermittedSignalsEnabled) connection = 'limited'
  else connection = 'connected'

  return {
    // raw enums (for aria + analytics)
    confidential,
    ai,
    recording,
    admission,
    guestsAllowed,
    connection,
    // rendered tile descriptors — label/value are already localized strings
    tiles: [
      {
        key: 'confidential',
        label: t('meeting.lobby.tile.confidential'),
        value: confidential ? t('meeting.lobby.tile.confidential.active') : t('meeting.lobby.tile.confidential.off'),
        tone: confidential ? TONE.GOOD : TONE.MUTED,
        icon: 'shield',
      },
      {
        key: 'ai',
        label: t('meeting.lobby.tile.ai'),
        value: t(`meeting.lobby.tile.ai.${ai}`),
        tone: ai === 'enabled' ? TONE.ACCENT : TONE.MUTED,
        icon: 'sparkles',
      },
      {
        key: 'recording',
        label: t('meeting.lobby.tile.recording'),
        value: recording === 'on' ? t('meeting.lobby.tile.recording.on') : t('meeting.lobby.tile.recording.off'),
        tone: recording === 'on' ? TONE.WARN : TONE.GOOD,
        icon: 'record',
      },
      {
        key: 'guests',
        label: t('meeting.lobby.tile.guests'),
        value: guestsAllowed ? t('meeting.lobby.tile.guests.allowed') : t('meeting.lobby.tile.guests.off'),
        tone: guestsAllowed ? TONE.WARN : TONE.GOOD,
        icon: 'users',
      },
      {
        key: 'admission',
        label: t('meeting.lobby.tile.admission'),
        value: t(`meeting.lobby.tile.admission.${admission}`),
        tone: admission === 'not_required' ? TONE.GOOD : TONE.ACCENT,
        icon: 'admission',
      },
    ],
  }
}

export { TONE as ACCESS_TONE }
