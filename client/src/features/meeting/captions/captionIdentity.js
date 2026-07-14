/**
 * Canonical participant identity for captions.
 *
 * ONE source of truth so a speaker never renders as "Guest", a raw SID, or a
 * stale name. Everything is derived from the LiveKit participant, whose identity
 * (`u:{user_id}`) and name are minted server-side on the access token
 * (livekit_provider.py) — never guessed from the transcript.
 *
 * Guest status + display name come from the token metadata JSON
 * ({ displayName, role, guest }); we fall back to participant.name, then a
 * neutral placeholder, in that order.
 */
import { speakerColor } from './speakerColor'

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function parseMeta(participant) {
  try {
    return participant?.metadata ? JSON.parse(participant.metadata) : null
  } catch {
    return null
  }
}

/**
 * @param {import('livekit-client').Participant} participant
 * @returns {{ speakerId: string, name: string, isGuest: boolean, color: string, initials: string }}
 */
export function resolveIdentity(participant) {
  const speakerId = participant?.identity || 'unknown'
  const meta = parseMeta(participant)
  const name =
    (meta && typeof meta.displayName === 'string' && meta.displayName) ||
    participant?.name ||
    'Guest'
  const isGuest = !!(meta && meta.guest)
  return {
    speakerId,
    name,
    isGuest,
    color: speakerColor(speakerId),
    initials: initialsOf(name),
  }
}

/** Build an identity object from loose parts (data-channel fallback path). */
export function identityFromParts({ speakerId, name }) {
  const id = speakerId || 'unknown'
  const nm = name || 'Guest'
  return { speakerId: id, name: nm, isGuest: false, color: speakerColor(id), initials: initialsOf(nm) }
}
