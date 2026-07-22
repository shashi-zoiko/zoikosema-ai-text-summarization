/**
 * Participant-action capability resolver.
 *
 * Actions are resolved DYNAMICALLY from server capability state — permissions are
 * never hardcoded per component. The viewer's capability object is authoritative
 * and comes from the server (added to the snapshot as an additive `capabilities`
 * block; see the backend integration). `deriveViewerCapabilities` is only a
 * FALLBACK that mirrors the server's existing authority rules
 * (`_require_host_or_cohost`, host-only promote) so the UI is correct even before
 * a server carrying the explicit block is deployed — it never grants more than
 * the server would.
 *
 * ABSOLUTELY PROHIBITED (they do not exist in the ACTION enum and can never be
 * produced here): remote unmute, remote camera start. Mute-others / remove /
 * spotlight also do not exist (deliberately removed / owned by later Host Console
 * packages) — the resolver simply has no branch that yields them.
 */
import { ACTION, ROLE, STATUS } from './constants.js'

// Documented for the guard test: these must never be resolvable anywhere.
export const PROHIBITED_ACTIONS = Object.freeze(['remote_unmute', 'remote_camera_start'])

/**
 * Fallback capability derivation from the viewer's authoritative role.
 * @param {{role?: string, isHost?: boolean}} viewer
 */
export function deriveViewerCapabilities(viewer = {}) {
  const isHost = viewer.isHost === true || viewer.role === ROLE.HOST
  const isCohost = viewer.role === ROLE.COHOST
  return Object.freeze({
    admit: isHost || isCohost, // _require_host_or_cohost
    manageWaiting: isHost || isCohost,
    promote: isHost, // server: promote is host-only
    demote: isHost,
    lock: isHost || isCohost,
    setPermissions: isHost || isCohost,
  })
}

/** Normalize any capability source (server block or derived) into a full shape. */
export function normalizeCapabilities(caps) {
  const base = deriveViewerCapabilities({})
  if (!caps) return base
  return Object.freeze({
    admit: !!(caps.admit ?? base.admit),
    manageWaiting: !!(caps.manageWaiting ?? caps.admit ?? base.manageWaiting),
    promote: !!(caps.promote ?? base.promote),
    demote: !!(caps.demote ?? base.demote),
    lock: !!(caps.lock ?? base.lock),
    setPermissions: !!(caps.setPermissions ?? base.setPermissions),
  })
}

/**
 * Resolve the actions available on ONE participant row.
 * @param {{viewerCaps: object, viewerKey?: string, target: object}} args
 * @returns {Array<{action: string, available: boolean, reason?: string}>}
 */
export function resolveRowActions({ viewerCaps, viewerKey, target }) {
  const caps = normalizeCapabilities(viewerCaps)
  const isSelf = target.isSelf === true || (viewerKey != null && String(viewerKey) === String(target.key))
  const out = []

  if (target.status === STATUS.WAITING) {
    // Admission actions only exist for queued people.
    out.push(action(ACTION.ADMIT, caps.admit, 'not_authorized'))
    out.push(action(ACTION.DENY, caps.admit, 'not_authorized'))
    return out
  }

  // Role changes — never on self, gated on server capability.
  if (target.role === ROLE.PARTICIPANT && !isSelf) {
    out.push(action(ACTION.PROMOTE, caps.promote, 'not_authorized'))
  }
  if (target.role === ROLE.COHOST && !isSelf) {
    out.push(action(ACTION.DEMOTE, caps.demote, 'not_authorized'))
  }

  // Lower hand: a participant may lower their OWN raised hand. (Host-lower-other
  // is not a server capability today, so it is not offered.)
  if (target.handRaised && isSelf) {
    out.push(action(ACTION.LOWER_HAND, true))
  }

  // Pin/unpin is a LOCAL view control (never a server mutation) — always allowed.
  out.push(action(target.pinned ? ACTION.UNPIN : ACTION.PIN, true))

  return out
}

/** Queue-level actions (Admit All). */
export function resolveQueueActions({ viewerCaps, waitingCount = 0 }) {
  const caps = normalizeCapabilities(viewerCaps)
  return [action(ACTION.ADMIT_ALL, caps.admit && waitingCount > 0, waitingCount > 0 ? 'not_authorized' : 'empty_queue')]
}

/** Only the actions actually offered (available === true). */
export function availableActions(resolved) {
  return resolved.filter((a) => a.available).map((a) => a.action)
}

function action(name, available, reason) {
  return available ? { action: name, available: true } : { action: name, available: false, reason: reason || 'unavailable' }
}
