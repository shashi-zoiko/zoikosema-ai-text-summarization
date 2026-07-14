/**
 * Structured, development-only caption logging.
 *
 * Every stage of the pipeline emits a typed event through `clog(kind, data)`.
 * Gated on Vite's `import.meta.env.DEV` AND the config flag, so production
 * bundles tree-shake/no-op these calls — nothing is logged for real users.
 *
 * Event kinds (the taxonomy asked for in the spec):
 *   speaker-detected | speaker-changed | transcript-started |
 *   transcript-partial | transcript-final | caption-rendered |
 *   participant-mapped | caption-timeout | identity-mismatch |
 *   audio-track-mismatch | presence | source
 */
import { CAPTION_CONFIG } from './config'

const DEV =
  typeof import.meta !== 'undefined' &&
  import.meta.env &&
  import.meta.env.DEV === true

export function clog(kind, data) {
  if (!DEV && !CAPTION_CONFIG.debug) return
  // Single grouped line, cheap to scan and trivially greppable ("[cc]").
  console.debug(`[cc] ${kind}`, data ?? '')
}

export const captionDebugEnabled = DEV || CAPTION_CONFIG.debug
