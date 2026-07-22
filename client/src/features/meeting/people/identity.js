/**
 * Single source of truth for participant identity reconciliation.
 *
 * The meeting has two planes keyed differently: the LiveKit media plane uses a
 * string identity (`"u:42"`), while the control-WS plane uses the numeric
 * `user_id`. The legacy code hand-merged them with an `identityToUserId` helper
 * DUPLICATED in ParticipantsPanel.jsx and ParticipantTile.jsx and re-derived on
 * every render — the core modeling hazard the audit flagged.
 *
 * This module hoists that logic to ONE place and defines the People module's
 * canonical key: `String(user_id)`. Everything (waiting entries, media peers,
 * roles, hands, pending actions) collapses onto this key so a person can never
 * appear as two rows.
 */

/** LiveKit identity → numeric user_id (or null for unrecognized identities). */
export function identityToUserId(identity) {
  if (identity == null) return null
  const s = String(identity)
  if (s.startsWith('u:')) {
    // Extract the LEADING integer after "u:" so multi-session suffixes
    // ("u:42#2", "u:42-tab") collapse onto the same user — multi-session
    // support without duplicate rows.
    const m = s.slice(2).match(/^\d+/)
    return m ? Number(m[0]) : null
  }
  // A bare numeric identity is tolerated for forward-compat.
  const n = Number(s)
  return Number.isFinite(n) && s.trim() !== '' ? n : null
}

/** numeric user_id → canonical LiveKit identity. */
export function userIdToIdentity(userId) {
  return userId == null ? null : `u:${userId}`
}

/**
 * Canonical People key for any inbound reference. Accepts a numeric user_id, a
 * numeric string, or a LiveKit identity ("u:42") and returns the stable string
 * key, or null if it cannot be resolved.
 */
export function personKey(ref) {
  if (ref == null) return null
  if (typeof ref === 'number') return Number.isFinite(ref) ? String(ref) : null
  const s = String(ref)
  if (s.startsWith('u:')) {
    const uid = identityToUserId(s)
    return uid == null ? null : String(uid)
  }
  const n = Number(s)
  if (Number.isFinite(n) && s.trim() !== '') return String(n)
  // Opaque identity (e.g. a service/bot with no numeric id) — key by itself so
  // it still dedupes to one row rather than being dropped.
  return s
}

/** Key from a numeric user_id specifically (control-plane records). */
export function keyFromUserId(userId) {
  return userId == null ? null : String(userId)
}
