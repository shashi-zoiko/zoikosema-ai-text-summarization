/**
 * Read-only connection-stats sampler (ZS-MTG-IMP-03 §10.1, §11).
 *
 * Reuses LiveKit's existing per-track `getRTCStatsReport()` (queries the live peer
 * connection — NOT a new RTCPeerConnection observer or a second monitoring
 * pipeline) plus already-published state (room.state, connectionQuality). Purely
 * observational: it reads, never mutates media/subscriptions/participants.
 *
 * Privacy (§11): emits only quality classes, bitrate/rtt/jitter/loss ranges, a
 * resolution and a transport CLASS (direct / relay + protocol) — never raw IPs,
 * candidates, or secret material.
 */

function publicationsOf(participant) {
  if (!participant) return []
  const src = participant.trackPublications || participant.tracks
  if (!src) return []
  return typeof src.values === 'function' ? Array.from(src.values()) : Object.values(src)
}

// direct (host/srflx) vs relay (TURN), with protocol — no addresses.
function transportClass(candidate) {
  if (!candidate) return null
  const type = candidate.candidateType
  const proto = (candidate.relayProtocol || candidate.protocol || '').toUpperCase()
  if (type === 'relay') return `Relay${proto ? ` (TURN-${proto})` : ' (TURN)'}`
  if (type === 'host' || type === 'srflx' || type === 'prflx') return `Direct${proto ? ` (${proto})` : ''}`
  return proto || null
}

export async function collectConnectionStats(room, prevRef) {
  if (!room) return null
  const lp = room.localParticipant
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const sample = {
    state: room.state || 'unknown',
    quality: lp?.connectionQuality || 'unknown',
    audio: { bitrate: null, packetLoss: null },
    video: { bitrate: null, rtt: null, jitter: null, width: null, height: null, fps: null, limitation: null },
    transport: null,
    ts: now,
  }

  const prev = prevRef.current || {}
  const nextPrev = {}

  for (const pub of publicationsOf(lp)) {
    const track = pub?.track
    const kind = pub?.kind || track?.kind // 'audio' | 'video'
    let report
    try { report = await track?.getRTCStatsReport?.() } catch { report = null }
    if (!report) continue

    const candidates = new Map()
    let nominatedLocalId = null

    report.forEach((s) => {
      if (s.type === 'outbound-rtp' && !s.isRemote) {
        const key = `${kind}:${s.ssrc ?? '0'}`
        nextPrev[key] = { bytes: s.bytesSent ?? 0, ts: now }
        const p = prev[key]
        if (p && now > p.ts) {
          const bps = ((s.bytesSent - p.bytes) * 8) / ((now - p.ts) / 1000)
          if (kind === 'video') sample.video.bitrate = bps
          else sample.audio.bitrate = bps
        }
        if (kind === 'video') {
          if (s.frameWidth) sample.video.width = s.frameWidth
          if (s.frameHeight) sample.video.height = s.frameHeight
          if (s.framesPerSecond != null) sample.video.fps = s.framesPerSecond
          if (s.qualityLimitationReason && s.qualityLimitationReason !== 'none') {
            sample.video.limitation = s.qualityLimitationReason
          }
        }
      } else if (s.type === 'remote-inbound-rtp') {
        if (s.roundTripTime != null) sample.video.rtt = s.roundTripTime * 1000
        if (s.jitter != null && kind === 'video') sample.video.jitter = s.jitter * 1000
        if (s.fractionLost != null) {
          if (kind === 'video') sample.video.packetLoss = s.fractionLost
          else sample.audio.packetLoss = s.fractionLost
        }
      } else if (s.type === 'candidate-pair' && (s.nominated || s.state === 'succeeded')) {
        nominatedLocalId = s.localCandidateId || nominatedLocalId
      } else if (s.type === 'local-candidate') {
        candidates.set(s.id, s)
      }
    })

    if (!sample.transport && nominatedLocalId && candidates.has(nominatedLocalId)) {
      sample.transport = transportClass(candidates.get(nominatedLocalId))
    }
  }

  prevRef.current = nextPrev
  return sample
}
