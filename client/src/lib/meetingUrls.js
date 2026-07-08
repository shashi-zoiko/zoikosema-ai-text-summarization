// Canonical meeting URL builders — the ONE place the meeting URL scheme is
// defined on the client. Meeting links live at the site root:
//
//   /<code>               → pre-join lobby (MeetLobby)
//   /<code>/room-lk       → LiveKit SFU room (the only media plane)
//   /<code>/intelligence  → meeting intelligence (auth-gated)
//
// The legacy /meet/<code>… paths still resolve via permanent client-side
// redirects in App.jsx, so old links, bookmarks, and previously-sent invite
// emails keep working. Build new links only through these helpers.

// LiveKit SFU is the only media plane now; /room is kept as a legacy alias
// (see App.jsx), but new navigation always targets /room-lk.
const ROOM_SUFFIX = '/room-lk'

/** Relative path to a meeting's pre-join lobby, e.g. `/abc-defg-hij`. */
export function meetingPath(code) {
  return `/${code}`
}

/** Relative path to the LiveKit room, e.g. `/abc-defg-hij/room-lk`. */
export function meetingRoomPath(code) {
  return `/${code}${ROOM_SUFFIX}`
}

/** Relative path to a meeting's intelligence page. */
export function meetingIntelligencePath(code) {
  return `/${code}/intelligence`
}

/** Relative path to the post-leave "you left the meeting" screen. */
export function meetingLeftPath(code) {
  return `/${code}/left`
}

/**
 * Absolute, shareable meeting URL (for copy-link buttons, etc.).
 * Uses the live browser origin by default; pass an explicit origin for tests.
 */
export function meetingUrl(code, origin = window.location.origin) {
  return `${origin}${meetingPath(code)}`
}

/**
 * Ready-to-paste invite message for chat apps (WhatsApp, SMS, …). The URL sits
 * on its own line so link-preview crawlers still unfurl it into the meeting card.
 */
export function meetingShareText(code, origin = window.location.origin) {
  const url = meetingUrl(code, origin)
  return (
    `To join the meeting on Zoiko Sema, click this link:\n${url}\n\n` +
    `Or open Zoiko Sema and enter this code:\n${code}`
  )
}
