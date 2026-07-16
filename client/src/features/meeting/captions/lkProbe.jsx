import { useEffect } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { RoomEvent, DataPacket_Kind } from 'livekit-client'
import { ctrace, traceEnabled } from './captionDebug'

/**
 * TEMPORARY LiveKit-SDK observation layer (root-cause instrumentation).
 *
 * Sits BELOW the caption system: it observes the raw LiveKit Room, WebRTC data
 * channels, participant lifecycle, transport stats, and browser environment —
 * and emits everything through the SAME `ctrace` ring buffer the caption
 * pipeline uses, so `window.__zoikoCaptions.timeline()` renders ONE unified
 * timeline (speech → caption → LiveKit) with no correlation work.
 *
 * PURE OBSERVER: it attaches listeners, samples getStats(), and wraps
 * publishData with a transparent log-then-delegate shim (restored on unmount).
 * It never alters caption logic, transport logic, payloads, sequencing,
 * presence, or rendering. Gated on the debug flag — no-op for real users.
 *
 * Remove this component (and its mount in MeetRoomLivekit) once the root cause
 * is found.
 */

const STATS_INTERVAL_MS = 4000

function browserDiagnostics() {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : {}
    ctrace('lk-browser', {
      ua: nav.userAgent,
      platform: nav.userAgentData?.platform || nav.platform,
      brands: (nav.userAgentData?.brands || []).map((b) => `${b.brand} ${b.version}`).join(';'),
      langs: (nav.languages || []).join(','),
      speech: !!(typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)),
      vis: typeof document !== 'undefined' ? document.visibilityState : '?',
      focus: typeof document !== 'undefined' ? document.hasFocus() : '?',
    })
    navigator.permissions?.query?.({ name: 'microphone' })
      .then((p) => ctrace('lk-mic-permission', { state: p.state }))
      .catch(() => { /* permission API absent (Safari) */ })
  } catch { /* best effort */ }
}

// Locate the underlying RTCPeerConnections without depending on a single
// private property name (they shift across livekit-client versions). Returns
// [role, RTCPeerConnection][].
function findPeerConnections(room) {
  const out = []
  try {
    const e = room.engine || {}
    const pm = e.pcManager || e.pcm || {}
    const candidates = [
      ['pub', pm.publisher], ['sub', pm.subscriber],
      ['pub', e.publisher], ['sub', e.subscriber],
    ]
    for (const [role, t] of candidates) {
      const pc = t?.pc || t?._pc || (typeof t?.getStats === 'function' ? t : null)
      if (pc && typeof pc.getStats === 'function' && !out.some(([, p]) => p === pc)) out.push([role, pc])
    }
  } catch { /* internals unavailable */ }
  return out
}

async function sampleStats(room) {
  const pcs = findPeerConnections(room)
  if (pcs.length === 0) { ctrace('lk-stats', { note: 'no RTCPeerConnection reachable via SDK internals' }); return }
  for (const [role, pc] of pcs) {
    ctrace('lk-pc-state', {
      role,
      ice: pc.iceConnectionState,
      conn: pc.connectionState,
      signaling: pc.signalingState,
    })
    try {
      const stats = await pc.getStats()
      let transport = null
      const pairs = new Map()
      const localCand = new Map()
      const remoteCand = new Map()
      let packetsLostIn = 0
      stats.forEach((r) => {
        if (r.type === 'transport') transport = r
        else if (r.type === 'candidate-pair') pairs.set(r.id, r)
        else if (r.type === 'local-candidate') localCand.set(r.id, r)
        else if (r.type === 'remote-candidate') remoteCand.set(r.id, r)
        else if (r.type === 'inbound-rtp' && typeof r.packetsLost === 'number') packetsLostIn += r.packetsLost
      })
      // Selected pair: prefer the transport's pointer, else a nominated/succeeded pair.
      let sel = transport?.selectedCandidatePairId ? pairs.get(transport.selectedCandidatePairId) : null
      if (!sel) for (const p of pairs.values()) { if (p.nominated || p.selected || p.state === 'succeeded') { sel = p; break } }
      const lc = sel ? localCand.get(sel.localCandidateId) : null
      const rc = sel ? remoteCand.get(sel.remoteCandidateId) : null
      ctrace('lk-stats', {
        role,
        dtls: transport?.dtlsState,
        iceState: transport?.iceState,
        rttMs: sel?.currentRoundTripTime != null ? Math.round(sel.currentRoundTripTime * 1000) : undefined,
        outBitrate: sel?.availableOutgoingBitrate,
        localCand: lc?.candidateType,
        remoteCand: rc?.candidateType,
        packetsLostIn,
      })
    } catch (err) {
      ctrace('lk-stats-FAIL', { role, err: String(err?.message || err) })
    }
  }
}

function roomInfo(room, label) {
  try {
    const lp = room.localParticipant
    const si = room.serverInfo || {}
    ctrace(`lk-room-${label}`, {
      state: room.state,
      roomSid: room.sid,
      self: lp?.identity,
      selfSid: lp?.sid,
      remotes: Array.from(room.remoteParticipants?.values?.() || []).map((p) => `${p.identity}#${p.sid}`).join('|') || '(none)',
      region: si.region,
      nodeId: si.nodeId,
      edge: si.edgeId,
      serverVersion: si.version,
      serverAddr: room.engine?.connectedServerAddress,
    })
  } catch { /* best effort */ }
}

export default function LiveKitDiagnostics() {
  const room = useRoomContext()

  useEffect(() => {
    if (!room || !traceEnabled()) return undefined

    browserDiagnostics()
    roomInfo(room, 'mount')

    // ── 1. Room connection state ────────────────────────────────────────────
    const onConn = (state) => { ctrace('lk-conn-state', { state, roomSid: room.sid }) }
    const onConnected = () => { roomInfo(room, 'connected') }
    const onReconnecting = () => ctrace('lk-reconnecting', {})
    const onReconnected = () => { ctrace('lk-reconnected', {}); roomInfo(room, 'reconnected') }
    const onDisconnected = (reason) => ctrace('lk-disconnected', { reason })
    const onSignal = () => ctrace('lk-signal-connected', {})

    // ── 4. Participant + track events ───────────────────────────────────────
    const onPJoin = (p) => ctrace('lk-participant-connected', { identity: p?.identity, sid: p?.sid })
    const onPLeave = (p) => ctrace('lk-participant-disconnected', { identity: p?.identity, sid: p?.sid })
    const onTrackPub = (pub, p) => ctrace('lk-track-published', { identity: p?.identity, source: pub?.source, trackSid: pub?.trackSid })
    const onTrackSub = (_t, pub, p) => ctrace('lk-track-subscribed', { identity: p?.identity, source: pub?.source, trackSid: pub?.trackSid })
    const onTrackMute = (pub, p) => ctrace('lk-track-muted', { identity: p?.identity, source: pub?.source })
    const onTrackUnmute = (pub, p) => ctrace('lk-track-unmuted', { identity: p?.identity, source: pub?.source })
    const onLocalPub = (pub) => ctrace('lk-local-track-published', { source: pub?.source, trackSid: pub?.trackSid })

    // ── 5. Connection quality ───────────────────────────────────────────────
    const onQuality = (q, p) => ctrace('lk-connection-quality', { identity: p?.identity, quality: q })

    // ── 3. Incoming data packets (SDK level, ALL topics) ────────────────────
    const onData = (payload, participant, kind, topic) => {
      ctrace('lk-data-in', {
        from: participant?.identity || '(server)',
        sid: participant?.sid,
        bytes: payload?.byteLength ?? payload?.length ?? 0,
        reliable: kind === DataPacket_Kind.RELIABLE,
        topic: topic ?? '(none)',
      })
    }

    room.on(RoomEvent.ConnectionStateChanged, onConn)
    room.on(RoomEvent.Connected, onConnected)
    room.on(RoomEvent.Reconnecting, onReconnecting)
    room.on(RoomEvent.Reconnected, onReconnected)
    room.on(RoomEvent.Disconnected, onDisconnected)
    room.on(RoomEvent.SignalConnected, onSignal)
    room.on(RoomEvent.ParticipantConnected, onPJoin)
    room.on(RoomEvent.ParticipantDisconnected, onPLeave)
    room.on(RoomEvent.TrackPublished, onTrackPub)
    room.on(RoomEvent.TrackSubscribed, onTrackSub)
    room.on(RoomEvent.TrackMuted, onTrackMute)
    room.on(RoomEvent.TrackUnmuted, onTrackUnmute)
    room.on(RoomEvent.LocalTrackPublished, onLocalPub)
    room.on(RoomEvent.ConnectionQualityChanged, onQuality)
    room.on(RoomEvent.DataReceived, onData)

    // ── 3. Outgoing data packets — transparent log-then-delegate shim ───────
    // Wrapping publishData is the only way to observe EVERY outgoing packet at
    // the SDK boundary. It logs then calls the original with identical args and
    // return value — behaviour is unchanged. Restored on unmount.
    const lp = room.localParticipant
    const originalPublishData = lp && typeof lp.publishData === 'function' ? lp.publishData : null
    if (originalPublishData) {
      lp.publishData = function patchedPublishData(data, ...rest) {
        try {
          const opts = rest[0] || {}
          ctrace('lk-data-out', {
            self: lp.identity,
            bytes: data?.byteLength ?? data?.length ?? 0,
            reliable: opts?.reliable,
            topic: opts?.topic ?? '(none)',
            to: (opts?.destinationIdentities || []).join('|') || 'all',
          })
        } catch { /* logging must never break a real send */ }
        return originalPublishData.apply(this, [data, ...rest])
      }
    }

    // ── 2 + 5. DataChannel readyState/buffered + transport stats sampler ─────
    const sampleDataChannels = () => {
      try {
        const e = room.engine || {}
        const named = [
          ['reliable', e.reliableDC || e.reliableDCSub || e.pcManager?.reliableDC],
          ['lossy', e.lossyDC || e.lossyDCSub || e.pcManager?.lossyDC],
        ]
        for (const [kind, dc] of named) {
          if (dc && typeof dc.readyState === 'string') {
            ctrace('lk-datachannel', { kind, readyState: dc.readyState, label: dc.label, buffered: dc.bufferedAmount })
          }
        }
      } catch { /* internals unavailable — stats sampler still covers ICE/DTLS */ }
    }

    sampleDataChannels()
    sampleStats(room)
    const timer = setInterval(() => { sampleDataChannels(); sampleStats(room) }, STATS_INTERVAL_MS)

    // ── 6. Visibility / focus changes (Web Speech pauses when backgrounded) ──
    const onVis = () => ctrace('lk-visibility', { state: document.visibilityState, focus: document.hasFocus() })
    const onFocus = () => ctrace('lk-focus', { focus: true })
    const onBlur = () => ctrace('lk-focus', { focus: false })
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVis)
      window.addEventListener('focus', onFocus)
      window.addEventListener('blur', onBlur)
    }

    return () => {
      clearInterval(timer)
      room.off(RoomEvent.ConnectionStateChanged, onConn)
      room.off(RoomEvent.Connected, onConnected)
      room.off(RoomEvent.Reconnecting, onReconnecting)
      room.off(RoomEvent.Reconnected, onReconnected)
      room.off(RoomEvent.Disconnected, onDisconnected)
      room.off(RoomEvent.SignalConnected, onSignal)
      room.off(RoomEvent.ParticipantConnected, onPJoin)
      room.off(RoomEvent.ParticipantDisconnected, onPLeave)
      room.off(RoomEvent.TrackPublished, onTrackPub)
      room.off(RoomEvent.TrackSubscribed, onTrackSub)
      room.off(RoomEvent.TrackMuted, onTrackMute)
      room.off(RoomEvent.TrackUnmuted, onTrackUnmute)
      room.off(RoomEvent.LocalTrackPublished, onLocalPub)
      room.off(RoomEvent.ConnectionQualityChanged, onQuality)
      room.off(RoomEvent.DataReceived, onData)
      if (originalPublishData && lp) {
        try { delete lp.publishData } catch { lp.publishData = originalPublishData }
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVis)
        window.removeEventListener('focus', onFocus)
        window.removeEventListener('blur', onBlur)
      }
    }
  }, [room])

  return null
}
