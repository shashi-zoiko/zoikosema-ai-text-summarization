import { api } from '../../../api/client'

/**
 * Mints a short-lived LiveKit JWT for the current user in the given meeting.
 * Caller must already have called POST /api/meetings/{code}/join and been admitted.
 *
 * Returns { access_token, ws_url, room, identity, expires_at }.
 */
export function fetchMediaToken(code) {
  return api(`/api/meetings/${code}/media-token`, { method: 'POST' })
}
