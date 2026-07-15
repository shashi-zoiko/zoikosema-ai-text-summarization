/**
 * Caption transcript buffer — the engine-agnostic heart of the pipeline.
 *
 * Maintains one INDEPENDENT streaming buffer per speaker (keyed by canonical
 * LiveKit identity), so overlapping speech is never merged: A, B and C each get
 * their own accumulating transcript. Frames are ordered and de-duplicated by a
 * per-sender monotonic sequence number, so async-decrypt races and lossy-interim
 * reordering can't rewind or duplicate a caption.
 *
 * Lifecycle per utterance (Google-Meet semantics):
 *   partial → partial → … → final(s) commit → fade after silenceTimeout
 * Interims update `partial`; finals append to `finalText` (an utterance can have
 * several final phrases); a new `utteranceId` rolls the buffer to a fresh line
 * instead of overwriting — no "sentence restart", no cross-utterance merge.
 *
 * This module is FRAMEWORK-FREE and pure aside from the injected scheduler, so
 * it is unit-testable without React (see captionStore.test.mjs). React consumes
 * it through useSyncExternalStore via {subscribe,getSnapshot}.
 *
 * @typedef {Object} SpeakerBuffer
 * @property {string} speakerId  canonical LiveKit identity (e.g. "u:42")
 * @property {string} name       resolved display name
 * @property {boolean} isGuest
 * @property {string} color
 * @property {string} initials
 * @property {string} partial    in-progress interim text (not yet final)
 * @property {string} finalText  committed finals for the CURRENT utterance
 * @property {string} text       display text = finalText + partial
 * @property {'speaking'|'idle'} state
 * @property {number} seq        last accepted sequence number
 * @property {number} utteranceId
 * @property {number} confidence
 * @property {string} lang
 * @property {number} ts         last update (ms)
 * @property {number} startedAt  current utterance start (ms)
 */

const defaultScheduler = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
}

export function createCaptionStore({ config, scheduler = defaultScheduler, onEvent } = {}) {
  const cfg = config
  let bySpeaker = {} // speakerId -> SpeakerBuffer  (immutable snapshots)
  let snapshot = bySpeaker
  const listeners = new Set()
  const timers = new Map() // speakerId -> timeout handle

  const emit = (kind, data) => { try { onEvent?.(kind, data) } catch { /* logging must never break the pipeline */ } }

  const publish = () => {
    snapshot = bySpeaker
    for (const l of listeners) l()
  }

  const armExpiry = (speakerId) => {
    const existing = timers.get(speakerId)
    if (existing) scheduler.clearTimeout(existing)
    const handle = scheduler.setTimeout(() => {
      timers.delete(speakerId)
      remove(speakerId, 'timeout')
    }, cfg.silenceTimeoutMs)
    timers.set(speakerId, handle)
  }

  /**
   * Accept a caption frame. Returns true if it changed state, false if dropped
   * (stale/duplicate/empty). `identity` carries the canonical resolved fields.
   */
  function ingest(frame) {
    const {
      speakerId,
      seq = 0,
      utteranceId = 0,
      text = '',
      isFinal = false,
      confidence = 0,
      lang = cfg.lang,
      identity = {},
    } = frame || {}
    if (!speakerId) return false

    const prev = bySpeaker[speakerId]

    // Ordering + dedup: sequence numbers are strictly increasing per sender, so
    // anything not newer than what we've accepted is a straggler or a repeat.
    if (prev && seq <= prev.seq) {
      emit('caption-dropped', { speakerId, seq, lastSeq: prev.seq })
      return false
    }

    const now = scheduler.now()
    const name = identity.name || prev?.name || 'Guest'
    const isNewUtterance = !prev || utteranceId !== prev.utteranceId
    const base = isNewUtterance
      ? { finalText: '', partial: '', startedAt: now }
      : { finalText: prev.finalText, partial: prev.partial, startedAt: prev.startedAt }

    if (isNewUtterance) emit('transcript-started', { speakerId, utteranceId })

    let { finalText, partial } = base
    if (isFinal) {
      finalText = finalText ? `${finalText} ${text}` : text
      partial = ''
      emit('transcript-final', { speakerId, utteranceId, seq })
    } else {
      partial = text
      emit('transcript-partial', { speakerId, utteranceId, seq })
    }

    const display = `${finalText} ${partial}`.trim()

    bySpeaker = {
      ...bySpeaker,
      [speakerId]: {
        speakerId,
        name,
        isGuest: identity.isGuest ?? prev?.isGuest ?? false,
        color: identity.color || prev?.color || '#cbd5e1',
        initials: identity.initials || prev?.initials || '',
        partial,
        finalText,
        text: display,
        state: 'speaking',
        seq,
        utteranceId,
        confidence,
        lang,
        ts: now,
        startedAt: base.startedAt,
      },
    }
    publish()
    armExpiry(speakerId)
    return true
  }

  /** Refresh a speaker's identity in place (rename / metadata change). */
  function refreshIdentity(speakerId, identity) {
    const prev = bySpeaker[speakerId]
    if (!prev || !identity) return
    const next = { ...prev }
    let changed = false
    for (const k of ['name', 'isGuest', 'color', 'initials']) {
      if (identity[k] != null && identity[k] !== prev[k]) { next[k] = identity[k]; changed = true }
    }
    if (!changed) return
    bySpeaker = { ...bySpeaker, [speakerId]: next }
    publish()
    emit('participant-mapped', { speakerId, name: next.name })
  }

  /** Remove a speaker's caption immediately (disconnect / silence timeout). */
  function remove(speakerId, reason = 'remove') {
    const handle = timers.get(speakerId)
    if (handle) { scheduler.clearTimeout(handle); timers.delete(speakerId) }
    if (!bySpeaker[speakerId]) return
    const next = { ...bySpeaker }
    delete next[speakerId]
    bySpeaker = next
    publish()
    emit(reason === 'timeout' ? 'caption-timeout' : 'caption-removed', { speakerId, reason })
  }

  /** Tear everything down (leaving the meeting). */
  function purgeAll() {
    for (const h of timers.values()) scheduler.clearTimeout(h)
    timers.clear()
    if (Object.keys(bySpeaker).length === 0) return
    bySpeaker = {}
    publish()
  }

  return {
    ingest,
    refreshIdentity,
    remove,
    purgeAll,
    getSnapshot: () => snapshot,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
  }
}
