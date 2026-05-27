import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getApiBase, getWsBase } from '../api/client'
import { useAuth } from '../context/AuthContext'
import useSpeakerDetection from '../hooks/useSpeakerDetection'
import useMediaDevices from '../hooks/useMediaDevices'
import MeetingDock from '../components/meeting/MeetingDock'
import PeerTile from '../components/meeting/PeerTile'
import {
  Check, Copy, Lock, ShieldCheck, Crown, MicOff, VideoOff, MonitorUp, Hand,
  X, Send, MessageSquare, Users, Settings as SettingsIcon, Clock,
  PhoneOff, Pin,
} from 'lucide-react'

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

const QUALITY_PRESETS = {
  high:   { width: 1280, height: 720,  frameRate: 30, maxBitrate: 2_500_000 },
  medium: { width: 640,  height: 480,  frameRate: 24, maxBitrate: 1_000_000 },
  low:    { width: 320,  height: 240,  frameRate: 15, maxBitrate: 500_000 },
}

// Production-grade microphone constraints. Mono is correct for voice (stereo
// doubles bandwidth for no perceptual gain on speech). 48 kHz is what Opus
// encodes at natively — picking it explicitly avoids a resample step.
// Browser-default deviceLatency on cheap mics can sit at 200 ms+; clamping
// here is a hint, not a guarantee.
const AUDIO_CONSTRAINTS_BASE = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: 48000,
  sampleSize: 16,
  latency: 0.02,
}

// Per-sender Opus bitrate cap. 64 kbps is the Google Meet / Zoom ballpark for
// voice — well above the Opus default and high enough that multi-user audio
// stays clear without overwhelming uplink on slow connections.
const AUDIO_MAX_BITRATE = 64_000

// SDP munger: turn on Opus FEC + DTX and pin maxaveragebitrate. Defaults vary
// per browser; setting these explicitly makes audio resilient under packet
// loss (FEC reconstructs dropped frames) and reduces background bandwidth
// (DTX sends silence frames). Idempotent — safe to run on any SDP.
function preferOpusAudio(sdp) {
  if (!sdp) return sdp
  const lines = sdp.split(/\r?\n/)
  let opusPayload = null
  for (const line of lines) {
    const m = /^a=rtpmap:(\d+)\s+opus\/48000/i.exec(line)
    if (m) { opusPayload = m[1]; break }
  }
  if (!opusPayload) return sdp
  const desiredParams = [
    'minptime=10',
    'useinbandfec=1',
    'usedtx=1',
    'stereo=0',
    'sprop-stereo=0',
    `maxaveragebitrate=${AUDIO_MAX_BITRATE}`,
    'maxplaybackrate=48000',
  ].join(';')
  const fmtpPrefix = `a=fmtp:${opusPayload}`
  let found = false
  const out = lines.map((line) => {
    if (line.startsWith(fmtpPrefix)) {
      found = true
      return `${fmtpPrefix} ${desiredParams}`
    }
    return line
  })
  if (!found) {
    const idx = out.findIndex((l) => l.startsWith(`a=rtpmap:${opusPayload} opus/48000`))
    if (idx >= 0) out.splice(idx + 1, 0, `${fmtpPrefix} ${desiredParams}`)
  }
  return out.join('\r\n')
}

export default function MeetRoom() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const selfPeerIdRef = useRef(null)
  const [peers, setPeers] = useState({})
  const [audioOn, setAudioOn] = useState(true)
  const [videoOn, setVideoOn] = useState(true)
  const [screenOn, setScreenOn] = useState(false)
  const [handRaised, setHandRaised] = useState(false)
  const [sidebar, setSidebar] = useState(null)
  const [chatMessages, setChatMessages] = useState([])
  const [chatDraft, setChatDraft] = useState('')
  const [reactions, setReactions] = useState([])
  const [showEmoji, setShowEmoji] = useState(false)
  const [err, setErr] = useState('')

  // Host controls state
  const [isHost, setIsHost] = useState(false)
  const [myRole, setMyRole] = useState('participant')
  const [waitingList, setWaitingList] = useState([])
  const [meetingLocked, setMeetingLocked] = useState(false)
  const [chatEnabled, setChatEnabled] = useState(true)
  const [screenshareEnabled, setScreenshareEnabled] = useState(true)
  const [permissionToast, setPermissionToast] = useState('')

  // Pin: per-viewer override that beats auto active-speaker. 'self' or peer_id.
  const [pinnedPeerId, setPinnedPeerId] = useState(null)

  // Wall-clock for the bottom-left badge (Google Meet-style "6:01 PM | code")
  const [clock, setClock] = useState(() => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
  useEffect(() => {
    const id = setInterval(() => {
      setClock(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  // Video/audio feature state
  const [layout, setLayout] = useState('grid')
  const [activeSpeaker, setActiveSpeaker] = useState(null)
  const [speakingPeers, setSpeakingPeers] = useState(new Set())
  const [qualityLevel, setQualityLevel] = useState('high')

  // Screen-share UI state
  const [showSharePicker, setShowSharePicker] = useState(false)
  // Current share mode lives in a ref because no UI reads it — only the
  // start/stop handlers care, and they don't need a re-render when it
  // changes. Was previously useState which forced a re-render on every
  // share toggle for nothing.
  const shareModeRef = useRef(null) // 'screen' | 'window' | 'tab'

  // Recording state
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const mediaRecorderRef = useRef(null)
  const recordedChunksRef = useRef([])
  const recordingTimerRef = useRef(null)

  const wsRef = useRef(null)
  const localStreamRef = useRef(null)
  const processedStreamRef = useRef(null)
  const screenStreamRef = useRef(null)
  const pcsRef = useRef({})
  const pendingIceRef = useRef({})
  const selfVideoRef = useRef(null)
  const chatEndRef = useRef(null)
  const reconnectTimerRef = useRef(null)
  const reconnectAttemptRef = useRef(0)
  const networkCheckRef = useRef(null)
  // Single in-flight lock for screen-share start/stop. Without this, a fast
  // double-click on "share" or "stop sharing" can interleave addTrack /
  // removeTrack across pcs and leave senders in an undefined state.
  const screenLockRef = useRef(false)
  // Same idea for the camera: a fast double-click on the camera button
  // could interleave a getUserMedia (ON) with a track.stop() (OFF), leaving
  // a zombie track on a sender or the camera light stuck on. The async
  // toggleVideo path makes this race trivial to hit without the lock.
  const cameraBusyRef = useRef(false)
  // Mirrors `videoOn` for use inside non-React paths (createPeerConnection,
  // setup, etc). React state is async; refs are not.
  const videoOnRef = useRef(true)
  // Same mirrors for audio/screen. The dock handlers need to read all three
  // at the moment they fire (to broadcast the full media-state). Reading
  // refs instead of state means the handlers can be wrapped in
  // useCallback([]) and stay stable across renders — which is what makes
  // React.memo on MeetingDock actually skip re-renders.
  const audioOnRef = useRef(true)
  const screenOnRef = useRef(false)

  const isHostOrCohost = isHost || myRole === 'co_host'

  const { devices, audioDeviceId, setAudioDeviceId, videoDeviceId, setVideoDeviceId } = useMediaDevices()

  const onSpeaking = useCallback((peerId, isSpeaking) => {
    setSpeakingPeers((prev) => {
      const next = new Set(prev)
      if (isSpeaking) {
        next.add(peerId)
        setActiveSpeaker(peerId)
      } else {
        next.delete(peerId)
        if (next.size > 0) setActiveSpeaker([...next][next.size - 1])
      }
      return next
    })
  }, [])
  const { attachStream, detachStream } = useSpeakerDetection(onSpeaking)

  // Callback ref: re-attach the active stream whenever the <video> remounts
  // (e.g. after toggling the camera off and back on, which unmounts the tile).
  //
  // Two defensive rules apply here, both rooted in the "ghost face" bug:
  //   1. When the element unmounts (el === null) we MUST clear srcObject on
  //      the *outgoing* node, otherwise Chromium keeps the last decoded frame
  //      painted on the detached element — visible as a frozen face if the
  //      node is briefly re-parented by React.
  //   2. When we attach a fresh stream we null first, then set. Skipping the
  //      null step makes Chrome reuse the previous decoder, which can replay
  //      the last frame of the old (stopped) stream for ~1 frame.
  const attachSelfVideoEl = useCallback((el) => {
    const prev = selfVideoRef.current
    if (prev && prev !== el) {
      try { prev.srcObject = null } catch {}
    }
    selfVideoRef.current = el
    if (!el) return
    const stream = screenStreamRef.current || processedStreamRef.current || localStreamRef.current
    if (!stream) {
      try { el.srcObject = null } catch {}
      return
    }
    if (el.srcObject !== stream) {
      try { el.srcObject = null } catch {}
      try { el.srcObject = stream } catch {}
    }
  }, [])

  // ── Helpers ────────────────────────────────────────────────────────────

  const getActiveStream = useCallback(() => {
    return processedStreamRef.current || localStreamRef.current
  }, [])

  const updatePeer = useCallback((peerId, patch) => {
    setPeers((prev) => {
      const existing = prev[peerId] || { peer_id: peerId }
      return { ...prev, [peerId]: { ...existing, ...patch } }
    })
  }, [])

  const removePeer = useCallback((peerId) => {
    const pc = pcsRef.current[peerId]
    if (pc) {
      // Cancel any pending ICE-restart / disconnect-grace timer attached by
      // the connectionstatechange handler — otherwise it can fire after the
      // PC is gone and try to recover a peer that's intentionally removed.
      if (pc.__recoveryTimer) { try { clearTimeout(pc.__recoveryTimer) } catch {}; pc.__recoveryTimer = null }
      try { pc.close() } catch {}
      delete pcsRef.current[peerId]
    }
    delete pendingIceRef.current[peerId]
    detachStream(peerId)
    setPeers((prev) => { const next = { ...prev }; delete next[peerId]; return next })
  }, [detachStream])

  const sendSignal = useCallback((payload) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload))
  }, [])

  const broadcastMediaState = useCallback((state) => {
    sendSignal({ type: 'media-state', audio: state.audio, video: state.video, screen: state.screen })
  }, [sendSignal])

  // ── Adaptive bitrate ───────────────────────────────────────────────────

  // Audio sender params have to be set AFTER setLocalDescription, otherwise
  // the encoder isn't built yet and setParameters silently no-ops. Called
  // from the negotiation paths once the offer/answer is committed.
  //
  // We set `priority: 'high'` and `networkPriority: 'high'` so audio packets
  // win the DSCP / pacing race over video — that's the difference between
  // "voice cuts when screenshare is bandwidth-heavy" and "voice stays clean".
  const applyAudioSenderParams = useCallback((pc) => {
    const sender = pc.__audioSender || pc.getSenders().find((s) => s.track?.kind === 'audio')
    if (!sender) return
    pc.__audioSender = sender
    try {
      const params = sender.getParameters()
      if (!params.encodings) params.encodings = [{}]
      params.encodings[0].maxBitrate = AUDIO_MAX_BITRATE
      params.encodings[0].priority = 'high'
      params.encodings[0].networkPriority = 'high'
      sender.setParameters(params).catch(() => {})
    } catch {}
  }, [])

  const applyBitrateLimit = useCallback(async (preset) => {
    // Skip throttling while screen sharing — readable text needs the
    // bandwidth even on bad networks. Screen-share bitrate is set
    // separately in startScreenShare and restored in stopScreenShare.
    if (screenStreamRef.current) return
    for (const pc of Object.values(pcsRef.current)) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
      if (sender) {
        try {
          const params = sender.getParameters()
          if (!params.encodings) params.encodings = [{}]
          params.encodings[0].maxBitrate = preset.maxBitrate
          params.encodings[0].maxFramerate = preset.frameRate
          await sender.setParameters(params)
        } catch {}
      }
    }
  }, [])

  const checkNetworkQuality = useCallback(async () => {
    const pcs = Object.values(pcsRef.current)
    if (pcs.length === 0) return
    try {
      const pc = pcs[0]
      const stats = await pc.getStats()
      let totalPacketsLost = 0, totalPacketsSent = 0, currentRoundTripTime = 0
      stats.forEach((report) => {
        if (report.type === 'outbound-rtp' && report.kind === 'video') totalPacketsSent += report.packetsSent || 0
        if (report.type === 'remote-inbound-rtp' && report.kind === 'video') {
          totalPacketsLost += report.packetsLost || 0
          currentRoundTripTime = report.roundTripTime || 0
        }
      })
      const lossRate = totalPacketsSent > 0 ? totalPacketsLost / totalPacketsSent : 0
      let newLevel = 'high'
      if (lossRate > 0.1 || currentRoundTripTime > 0.3) newLevel = 'low'
      else if (lossRate > 0.03 || currentRoundTripTime > 0.15) newLevel = 'medium'
      if (newLevel !== qualityLevel) {
        setQualityLevel(newLevel)
        await applyBitrateLimit(QUALITY_PRESETS[newLevel])
      }
    } catch {}
  }, [qualityLevel, applyBitrateLimit])

  // ── Peer connections ───────────────────────────────────────────────────

  const createPeerConnection = useCallback((remotePeerId, remoteInfo) => {
    if (pcsRef.current[remotePeerId]) return pcsRef.current[remotePeerId]
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

    // Screen share takes priority over camera when present. Otherwise a peer
    // who joins (or reconnects) mid-share would receive our camera track —
    // visible as our face if it's on, or a black tile if it's off — while
    // every existing peer correctly sees the screen via replaceTrack.
    //
    // Camera-off case: do NOT add a video track. A live but `enabled=false`
    // track here would still appear on the new peer's `ontrack`, attach to
    // their PeerTile, and freeze on whatever single frame was decoded before
    // mute — the exact "ghost face" symptom we're fixing. The new peer's
    // PeerTile will fall back to the gradient placeholder because no video
    // sender exists yet; when the camera comes back on, toggleVideo will
    // either replaceTrack (if a sender was made by negotiation) or addTrack
    // and trigger renegotiation.
    // Track the audio / video senders explicitly. After replaceTrack(null),
    // sender.track is null, so a later "find by track.kind === 'video'"
    // would miss it — and we'd addTrack a second video sender, producing
    // duplicate senders. Saving the references here is the only reliable
    // way to keep one canonical sender per kind across mute/unmute cycles.
    const camStream = processedStreamRef.current || localStreamRef.current
    const screenStream = screenStreamRef.current
    if (screenStream) {
      const sv = screenStream.getVideoTracks()[0]
      if (sv) pc.__videoSender = pc.addTrack(sv, screenStream)
      if (camStream) {
        for (const t of camStream.getAudioTracks()) pc.__audioSender = pc.addTrack(t, camStream)
      }
      const sa = screenStream.getAudioTracks()[0]
      if (sa) pc.addTrack(sa, screenStream)
    } else if (camStream) {
      for (const t of camStream.getAudioTracks()) pc.__audioSender = pc.addTrack(t, camStream)
      if (videoOnRef.current) {
        for (const t of camStream.getVideoTracks()) pc.__videoSender = pc.addTrack(t, camStream)
      }
    }

    // ── Perfect negotiation state ──────────────────────────────────────
    // Standard WebRTC pattern: the "polite" peer rolls back on glare, the
    // "impolite" peer ignores. We pick polite as "higher peer_id" so the
    // assignment is deterministic and the two sides agree without extra
    // signaling. makingOffer guards against negotiationneeded re-entrancy.
    pc.__makingOffer = false
    pc.__polite = (selfPeerIdRef.current && selfPeerIdRef.current > remotePeerId)
    pc.__ignoreOffer = false

    pc.onnegotiationneeded = async () => {
      try {
        pc.__makingOffer = true
        // Explicit create→munge→setLocal so we can rewrite the Opus fmtp
        // with FEC / DTX / bitrate. setLocalDescription() with no arg would
        // apply the unmunged version and we'd lose the ability to tell the
        // remote encoder what to do.
        const offer = await pc.createOffer()
        offer.sdp = preferOpusAudio(offer.sdp)
        await pc.setLocalDescription(offer)
        sendSignal({ type: 'offer', target: remotePeerId, payload: pc.localDescription })
        applyAudioSenderParams(pc)
      } catch (e) {
        console.error('onnegotiationneeded failed', e)
      } finally {
        pc.__makingOffer = false
      }
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal({ type: 'ice-candidate', target: remotePeerId, payload: e.candidate.toJSON() })
    }
    pc.ontrack = (e) => {
      const [remoteStream] = e.streams
      if (!remoteStream) return
      // ontrack fires once per track. During renegotiation it can fire again
      // with the same MediaStream already attached. Skipping the setState in
      // that case prevents PeerTile re-running its effect (which would null
      // + reattach srcObject and cause a brief audio glitch).
      if (pc.__attachedStreamId === remoteStream.id) return
      pc.__attachedStreamId = remoteStream.id
      updatePeer(remotePeerId, { ...(remoteInfo || {}), peer_id: remotePeerId, stream: remoteStream })
      attachStream(remotePeerId, remoteStream)
    }
    // Connection-state recovery: without this, a peer whose connection
    // drops (NAT timeout, brief network blip, sleep/wake) leaves a zombie
    // PC consuming resources and rendering a frozen tile forever.
    //
    //   failed       → unrecoverable, close + remove peer
    //   disconnected → recoverable, give 5s then attempt one ICE restart;
    //                  if still bad after another 10s, give up
    //   closed       → already torn down, just clear refs
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      if (import.meta.env.DEV) console.debug('[pc]', remotePeerId, '->', state)
      if (state === 'failed') {
        removePeer(remotePeerId)
        return
      }
      if (state === 'closed') {
        delete pcsRef.current[remotePeerId]
        return
      }
      if (state === 'connected') {
        if (pc.__recoveryTimer) { clearTimeout(pc.__recoveryTimer); pc.__recoveryTimer = null }
        pc.__iceRestartTried = false
        return
      }
      if (state === 'disconnected') {
        if (pc.__recoveryTimer) return
        pc.__recoveryTimer = setTimeout(async () => {
          pc.__recoveryTimer = null
          if (pc.connectionState !== 'disconnected') return
          // Only the side that originally sent the offer should restart ICE,
          // otherwise both sides do it simultaneously and glare ensues.
          const myId = selfPeerIdRef.current
          const shouldRestart = myId && myId < remotePeerId && !pc.__iceRestartTried
          if (shouldRestart) {
            pc.__iceRestartTried = true
            try {
              const offer = await pc.createOffer({ iceRestart: true })
              offer.sdp = preferOpusAudio(offer.sdp)
              await pc.setLocalDescription(offer)
              sendSignal({ type: 'offer', target: remotePeerId, payload: offer })
              applyAudioSenderParams(pc)
            } catch (e) { console.error('ICE restart failed', e) }
          }
          // Final timeout: if still not back after another 10s, give up.
          pc.__recoveryTimer = setTimeout(() => {
            pc.__recoveryTimer = null
            if (pc.connectionState !== 'connected' && pc.connectionState !== 'completed') {
              removePeer(remotePeerId)
            }
          }, 10000)
        }, 5000)
      }
    }
    pcsRef.current[remotePeerId] = pc
    applyBitrateLimit(QUALITY_PRESETS[qualityLevel])
    return pc
  }, [sendSignal, updatePeer, attachStream, applyBitrateLimit, applyAudioSenderParams, qualityLevel, removePeer])

  const negotiate = useCallback((remotePeerId, remoteInfo) => {
    // createPeerConnection adds tracks synchronously, which queues a
    // negotiationneeded event. The handler creates and sends the offer.
    // No need for a manual createOffer/setLocalDescription here — that
    // would race with the auto-negotiation and cause glare.
    createPeerConnection(remotePeerId, remoteInfo)
  }, [createPeerConnection])

  const handleOffer = useCallback(async (fromPeerId, fromName, payload) => {
    const pc = createPeerConnection(fromPeerId, { name: fromName })
    try {
      // Perfect negotiation: detect glare and resolve it deterministically.
      // If we're mid-offer ourselves and the remote sent one too, the polite
      // side rolls back and accepts the remote offer; the impolite side
      // ignores the incoming offer and lets its own complete.
      const offerCollision = pc.__makingOffer || pc.signalingState !== 'stable'
      pc.__ignoreOffer = !pc.__polite && offerCollision
      if (pc.__ignoreOffer) return

      if (offerCollision) {
        // Polite side: roll back our pending offer before accepting theirs.
        await pc.setLocalDescription({ type: 'rollback' })
      }
      await pc.setRemoteDescription(new RTCSessionDescription(payload))
      const pending = pendingIceRef.current[fromPeerId] || []
      for (const c of pending) { try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {} }
      pendingIceRef.current[fromPeerId] = []
      // Build answer explicitly so we can munge Opus params, then commit.
      const answer = await pc.createAnswer()
      answer.sdp = preferOpusAudio(answer.sdp)
      await pc.setLocalDescription(answer)
      sendSignal({ type: 'answer', target: fromPeerId, payload: pc.localDescription })
      applyAudioSenderParams(pc)
    } catch (e) { console.error('handleOffer failed', e) }
  }, [createPeerConnection, sendSignal, applyAudioSenderParams])

  const handleAnswer = useCallback(async (fromPeerId, payload) => {
    const pc = pcsRef.current[fromPeerId]
    if (!pc) return
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(payload))
      const pending = pendingIceRef.current[fromPeerId] || []
      for (const c of pending) { try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {} }
      pendingIceRef.current[fromPeerId] = []
      // Encoder isn't guaranteed to be live until both setLocal AND setRemote
      // complete; re-apply audio params now so the bitrate / priority hints
      // stick. setParameters is cheap and idempotent.
      applyAudioSenderParams(pc)
    } catch (e) { console.error('handleAnswer failed', e) }
  }, [applyAudioSenderParams])

  const handleIce = useCallback(async (fromPeerId, candidate) => {
    const pc = pcsRef.current[fromPeerId]
    if (!pc || !pc.remoteDescription) {
      // Bound the buffer so a peer that never sends an offer/answer can't
      // grow an unbounded queue. 50 candidates is well above what a normal
      // ICE gather produces (typically <20); anything beyond means the
      // remote is misbehaving or already gone.
      const existing = pendingIceRef.current[fromPeerId] || []
      if (existing.length >= 50) return
      pendingIceRef.current[fromPeerId] = [...existing, candidate]
      return
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    } catch (e) {
      // Ignored-offer path: when the impolite side declined a glare offer,
      // its ICE candidates also have to be dropped silently — not an error.
      if (!pc.__ignoreOffer) console.error('addIceCandidate failed', e)
    }
  }, [])

  const replaceTrackForAll = useCallback(async (newTrack, kind = 'video') => {
    for (const pc of Object.values(pcsRef.current)) {
      const sender = pc.getSenders().find((s) => s.track?.kind === kind)
      if (sender) { try { await sender.replaceTrack(newTrack) } catch {} }
    }
  }, [])

  // ── Mic recovery on device disappear ───────────────────────────────────
  // When the user unplugs USB headphones, switches Bluetooth profiles, or the
  // OS revokes the active mic for any reason, the track fires `ended` and the
  // sender goes silent for every peer. Without this, the user becomes
  // unilaterally inaudible with no UI feedback. We re-acquire the mic from
  // the current device (or default) and replaceTrack into existing senders so
  // no renegotiation is needed.
  //
  // The ref-then-callback structure breaks the chicken-and-egg between
  // recoverMicrophone and attachMicEndedHandler: the event listener reads
  // from the ref at fire time, so neither useCallback needs to depend on
  // the other.
  const micRecoveryBusyRef = useRef(false)
  const recoverMicrophoneRef = useRef(null)

  const attachMicEndedHandler = useCallback((track) => {
    if (!track || track.__zoikoMicWatched) return
    track.__zoikoMicWatched = true
    track.addEventListener('ended', () => {
      const fn = recoverMicrophoneRef.current
      if (fn) fn()
    })
  }, [])

  const recoverMicrophone = useCallback(async () => {
    if (micRecoveryBusyRef.current) return
    micRecoveryBusyRef.current = true
    try {
      const ls = localStreamRef.current
      if (!ls) return
      // Intentional stops remove the track from the stream before stop()
      // fires `ended`. If no ended track remains in the stream, we did the
      // stop ourselves — no recovery needed.
      const stillPresent = ls.getAudioTracks().some((t) => t.readyState === 'ended')
      if (!stillPresent) return
      const audioConstraints = audioDeviceId
        ? { ...AUDIO_CONSTRAINTS_BASE, deviceId: { ideal: audioDeviceId } }
        : { ...AUDIO_CONSTRAINTS_BASE }
      let fresh
      try {
        fresh = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
      } catch {
        // Specific device gone (e.g. unplugged USB mic). Fall back to default.
        try {
          fresh = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS_BASE })
        } catch {
          setPermissionToast('Microphone unavailable. Reconnect a device and unmute.')
          setTimeout(() => setPermissionToast(''), 4000)
          return
        }
      }
      const newTrack = fresh.getAudioTracks()[0]
      if (!newTrack) return
      newTrack.enabled = audioOnRef.current
      // Clean dead tracks out of the stream before adding the replacement.
      for (const t of ls.getAudioTracks()) {
        try { ls.removeTrack(t) } catch {}
        if (t.readyState !== 'ended') { try { t.stop() } catch {} }
      }
      ls.addTrack(newTrack)
      attachMicEndedHandler(newTrack)
      await replaceTrackForAll(newTrack, 'audio')
      attachStream('self', ls)
    } finally {
      micRecoveryBusyRef.current = false
    }
  }, [audioDeviceId, replaceTrackForAll, attachStream, attachMicEndedHandler])

  // Keep the ref pointing at the latest recoverMicrophone so the ended
  // listener (attached once per track) reads through to the current closure.
  useEffect(() => { recoverMicrophoneRef.current = recoverMicrophone }, [recoverMicrophone])

  // ── WebSocket connect ──────────────────────────────────────────────────

  const connectWs = useCallback(() => {
    // A pending reconnect from a previous close could fire concurrently with
    // a fresh connect (e.g. StrictMode double-mount, parent re-key). Cancel
    // it so we don't end up with two live sockets racing for the same room.
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    // If a socket is already in-flight or open, don't stack a second one on
    // top — the server would evict the duplicate via the 4001 path, but the
    // brief window of two-ws-per-tab is enough to double-play audio while
    // peers re-route their PCs.
    const existing = wsRef.current
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return
    }
    // Close any stale socket reference (CLOSING / CLOSED) before replacing.
    // Strip handlers first — otherwise its onclose would schedule a reconnect
    // and race with the new socket we're about to open.
    if (existing) {
      try { existing.onopen = existing.onmessage = existing.onclose = existing.onerror = null } catch {}
      try { existing.close() } catch {}
    }

    const token = localStorage.getItem('zoiko_token')
    const pwd = sessionStorage.getItem(`zoiko_meet_pwd_${code}`) || ''
    let wsUrl = `${getWsBase()}/ws/meetings/${code}?token=${encodeURIComponent(token)}`
    if (pwd) wsUrl += `&pwd=${encodeURIComponent(pwd)}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => { reconnectAttemptRef.current = 0 }

    ws.onmessage = async (e) => {
      let data
      try { data = JSON.parse(e.data) } catch { return }

      if (data.type === 'welcome') {
        selfPeerIdRef.current = data.self?.peer_id || null
        setIsHost(data.is_host)
        setMyRole(data.role || 'participant')
        if (data.meeting) {
          setMeetingLocked(data.meeting.locked || false)
          setChatEnabled(data.meeting.chat_enabled !== false)
          setScreenshareEnabled(data.meeting.screenshare_enabled !== false)
        }
        // Welcome is authoritative: after a reconnect or admit-from-waiting,
        // any peer_ids we tracked previously may be stale (their owner has a
        // new peer_id, or they left while we were offline). Drop everything
        // not present in this welcome before rebuilding.
        const validIds = new Set(data.peers.map((p) => p.peer_id))
        for (const oldPeerId of Object.keys(pcsRef.current)) {
          if (!validIds.has(oldPeerId)) {
            try { pcsRef.current[oldPeerId].close() } catch {}
            delete pcsRef.current[oldPeerId]
            delete pendingIceRef.current[oldPeerId]
            detachStream(oldPeerId)
          }
        }
        setPeers((prev) => {
          const next = {}
          const seenUserIds = new Set()
          for (const p of data.peers) {
            // Belt for the server's user_id filter: if the welcome ever
            // contains two entries for the same user_id (a stale ws that
            // wasn't reaped yet) render only the first one so we don't
            // inflate the "People · N" count with a ghost.
            if (p.user_id != null) {
              if (seenUserIds.has(p.user_id)) continue
              seenUserIds.add(p.user_id)
            }
            next[p.peer_id] = { ...(prev[p.peer_id] || {}), ...p }
          }
          return next
        })
        const prefs = JSON.parse(sessionStorage.getItem(`zoiko_meet_prefs_${code}`) || '{}')
        for (const p of data.peers) {
          if (data.self.peer_id < p.peer_id) await negotiate(p.peer_id, p)
        }
        broadcastMediaState({ audio: prefs.audio !== false, video: prefs.video !== false, screen: false })
      } else if (data.type === 'peer-joined') {
        // Defensive: never render ourselves as a remote peer.
        const myId = selfPeerIdRef.current
        if (myId && data.peer.peer_id === myId) {
          // skip
        } else {
          // If we still have a peer entry for this user_id under a different
          // peer_id, it's a ghost from a previous session that wasn't reaped
          // yet (browser crashed, network drop, etc). Drop it before adding
          // the new peer_id so the People count doesn't double-count.
          const incomingUserId = data.peer.user_id
          const incomingPeerId = data.peer.peer_id
          if (incomingUserId != null) {
            setPeers((prev) => {
              let changed = false
              const next = { ...prev }
              for (const [pid, p] of Object.entries(next)) {
                if (p && p.user_id === incomingUserId && pid !== incomingPeerId) {
                  const ghostPc = pcsRef.current[pid]
                  if (ghostPc) { try { ghostPc.close() } catch {}; delete pcsRef.current[pid] }
                  delete pendingIceRef.current[pid]
                  detachStream(pid)
                  delete next[pid]
                  changed = true
                }
              }
              return changed ? next : prev
            })
          }
          updatePeer(incomingPeerId, data.peer)
          if (myId && myId < incomingPeerId) negotiate(incomingPeerId, data.peer)
        }
      } else if (data.type === 'peer-left') {
        removePeer(data.peer_id)
      } else if (data.type === 'offer') {
        await handleOffer(data.from, data.from_user, data.payload)
      } else if (data.type === 'answer') {
        await handleAnswer(data.from, data.payload)
      } else if (data.type === 'ice-candidate') {
        await handleIce(data.from, data.payload)
      } else if (data.type === 'media-state') {
        // Don't create ghost peers: media-state lacks a name/user_id, so if
        // it arrives for an unknown peer_id (stale reconnect, out-of-order
        // delivery, late event from someone who already left) it would paint
        // a nameless "?" tile until the real peer-joined arrives — or forever.
        setPeers((prev) => {
          if (!prev[data.peer_id]) return prev
          return { ...prev, [data.peer_id]: { ...prev[data.peer_id], audio: data.audio, video: data.video, screen: data.screen } }
        })
      } else if (data.type === 'chat') {
        setChatMessages((prev) => [...prev, data])
      } else if (data.type === 'reaction') {
        const id = Math.random().toString(36).slice(2)
        setReactions((prev) => [...prev, { id, emoji: data.emoji, left: 10 + Math.random() * 80 }])
        setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), 2400)
      } else if (data.type === 'raise-hand') {
        setPeers((prev) => {
          if (!prev[data.peer_id]) return prev
          return { ...prev, [data.peer_id]: { ...prev[data.peer_id], hand: data.raised } }
        })
      } else if (data.type === 'waiting-room') {
        setWaitingList(data.waiting || [])
      } else if (data.type === 'role-changed') {
        if (data.user_id === user.id) setMyRole(data.role)
        setPeers((prev) => {
          const updated = { ...prev }
          for (const [pid, p] of Object.entries(updated)) {
            if (p.user_id === data.user_id) updated[pid] = { ...p, role: data.role }
          }
          return updated
        })
      } else if (data.type === 'meeting-locked') {
        setMeetingLocked(data.locked)
      } else if (data.type === 'meeting-permissions') {
        if (typeof data.chat_enabled === 'boolean') setChatEnabled(data.chat_enabled)
        if (typeof data.screenshare_enabled === 'boolean') setScreenshareEnabled(data.screenshare_enabled)
      } else if (data.type === 'permission-denied') {
        setPermissionToast(data.reason || 'Action not permitted.')
        setTimeout(() => setPermissionToast(''), 3500)
      } else if (data.type === 'meeting-ended') {
        setErr('The host has ended this meeting.')
      } else if (data.type === 'kicked') {
        setErr('You have been removed from this meeting.')
      }
      // screen-share-started / screen-share-stopped events are still
      // emitted by the server; the per-peer screen flag arrives via the
      // media-state path so no extra bookkeeping is needed client-side.
    }

    ws.onclose = (ev) => {
      // Terminal close codes: the server has decided this session is over.
      // Stop tracks and PCs *immediately* — otherwise the camera/mic stays
      // live and PCs keep sending media until the user navigates away. In
      // the 4001 (superseded) case that's the audio-echo window: the old
      // tab's senders keep pushing audio to peers who have already routed
      // to the new tab's PC, so peers briefly hear two of us.
      const terminal = (ev.code === 4401 || ev.code === 4404 || ev.code === 4403
        || ev.code === 4423 || ev.code === 4001)
      if (terminal) {
        for (const pc of Object.values(pcsRef.current)) { try { pc.close() } catch {} }
        pcsRef.current = {}
        if (localStreamRef.current) localStreamRef.current.getTracks().forEach((t) => { try { t.stop() } catch {} })
        if (processedStreamRef.current && processedStreamRef.current !== localStreamRef.current) {
          processedStreamRef.current.getTracks().forEach((t) => { try { t.stop() } catch {} })
        }
        if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach((t) => { try { t.stop() } catch {} })
      }
      if (ev.code === 4401) setErr('Session expired, please sign in again.')
      else if (ev.code === 4404) setErr('Meeting has ended.')
      else if (ev.code === 4403) setErr('You have been denied entry to this meeting.')
      else if (ev.code === 4423) setErr('This meeting is locked.')
      else if (ev.code === 4001) setErr('You joined this meeting from another tab or device.')
      else if (!err) {
        const attempt = reconnectAttemptRef.current
        if (attempt < 5) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000)
          reconnectAttemptRef.current = attempt + 1
          reconnectTimerRef.current = setTimeout(connectWs, delay)
        } else {
          setErr('Connection lost. Please rejoin the meeting.')
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, user])

  // ── Initialize local media and connect ─────────────────────────────────

  useEffect(() => {
    let cancelled = false
    async function setup() {
      try {
        const prefs = JSON.parse(sessionStorage.getItem(`zoiko_meet_prefs_${code}`) || '{}')
        // If the user pre-selected camera-off on the preflight, don't even
        // ask the browser for video — the camera light should never come
        // on. Same for audio. Saves a permission prompt too when the user
        // wants to join in a fully-off state.
        const wantAudio = prefs.audio !== false
        const wantVideo = prefs.video !== false
        const constraints = {}
        if (wantAudio) constraints.audio = { ...AUDIO_CONSTRAINTS_BASE }
        if (wantVideo) constraints.video = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
        // If neither, still need a MediaStream to add tracks to later.
        const stream = (wantAudio || wantVideo)
          ? await navigator.mediaDevices.getUserMedia(constraints)
          : new MediaStream()
        if (cancelled) { stream.getTracks().forEach((t) => { try { t.stop() } catch {} }); return }
        if (prefs.audio === false) {
          // Acquired with audio:false above, so there shouldn't be any —
          // belt anyway, in case browser ignored the constraint.
          stream.getAudioTracks().forEach((t) => { try { t.stop() } catch {} })
          setAudioOn(false)
        }
        if (prefs.video === false) {
          stream.getVideoTracks().forEach((t) => { try { t.stop() } catch {} })
          videoOnRef.current = false
          setVideoOn(false)
        }
        localStreamRef.current = stream
        processedStreamRef.current = stream
        for (const t of stream.getAudioTracks()) attachMicEndedHandler(t)
        if (selfVideoRef.current) selfVideoRef.current.srcObject = stream
        attachStream('self', stream)
        connectWs()
      } catch (e) {
        // Translate the standard DOMException names from getUserMedia into
        // something a user can actually act on. The raw .message varies by
        // browser (Chrome says "Permission denied", Safari says "The request
        // is not allowed by the user agent...") and isn't useful.
        const name = e?.name || ''
        let msg
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          msg = 'Camera/microphone access was blocked. Click the lock icon in the address bar and allow camera + microphone, then refresh.'
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          msg = 'No camera or microphone found. Connect a device and refresh, or join with audio/video disabled from the pre-call screen.'
        } else if (name === 'NotReadableError' || name === 'TrackStartError') {
          msg = 'Your camera or microphone is already in use by another app. Close it (Zoom, Teams, OBS, etc.) and refresh.'
        } else if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
          msg = 'Your camera does not support the requested resolution. Try a different camera in Settings.'
        } else if (name === 'AbortError') {
          msg = 'Camera/microphone access was interrupted. Refresh to try again.'
        } else {
          msg = e?.message || 'Could not start meeting.'
        }
        setErr(msg)
      }
    }
    setup()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  useEffect(() => {
    networkCheckRef.current = setInterval(checkNetworkQuality, 5000)
    return () => { if (networkCheckRef.current) clearInterval(networkCheckRef.current) }
  }, [checkNetworkQuality])

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (networkCheckRef.current) clearInterval(networkCheckRef.current)
      // Strip handlers before closing — otherwise onclose fires async after
      // unmount and the reconnect branch schedules a setTimeout against a
      // wsRef that's about to be garbage-collected (and pcs/streams we just
      // stopped). Net: zombie ws opens against an unmounted component.
      const ws = wsRef.current
      if (ws) {
        try { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null } catch {}
        try { ws.close() } catch {}
      }
      for (const pc of Object.values(pcsRef.current)) { try { pc.close() } catch {} }
      pcsRef.current = {}
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach((t) => t.stop())
      // Defensive: the processed stream (background effect / noise suppression
      // output) lives in its own ref; if the hook teardown below misses one
      // because state was inconsistent, stop those tracks here too.
      if (processedStreamRef.current && processedStreamRef.current !== localStreamRef.current) {
        processedStreamRef.current.getTracks().forEach((t) => { try { t.stop() } catch {} })
      }
      if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach((t) => t.stop())
    }
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  // Keep refs in sync with state so handlers wrapped in useCallback([]) can
  // read the latest values without re-creating the callback every render.
  useEffect(() => { audioOnRef.current = audioOn }, [audioOn])
  useEffect(() => { screenOnRef.current = screenOn }, [screenOn])

  // ── Mobile / bfcache resume ────────────────────────────────────────────
  // On mobile, switching apps (or pull-to-refresh, back-forward cache) puts
  // the page in bfcache. The browser tore down the WebSocket but React did
  // not re-mount — so the user comes back to a dead meeting. pageshow with
  // persisted=true is the standard signal for this; trigger a reconnect.
  useEffect(() => {
    const onPageShow = (e) => {
      if (!e.persisted) return
      const ws = wsRef.current
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        reconnectAttemptRef.current = 0
        connectWs()
      }
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [connectWs])

  // ── Media controls ─────────────────────────────────────────────────────

  const toggleAudio = useCallback(() => {
    if (!localStreamRef.current) return
    const next = !audioOnRef.current
    localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = next))
    if (processedStreamRef.current && processedStreamRef.current !== localStreamRef.current)
      processedStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = next))
    audioOnRef.current = next
    setAudioOn(next)
    broadcastMediaState({ audio: next, video: videoOnRef.current, screen: screenOnRef.current })
  }, [broadcastMediaState])

  // Camera lifecycle manager — see CAMERA_LIFECYCLE.md or the diff that
  // introduced this for the full root-cause rundown. The TL;DR:
  //   - Old code did `track.enabled = false`. WebRTC spec lets browsers
  //     interpret this as "send muted frames", which Chromium implements
  //     by simply not sending anything — and the remote <video> keeps
  //     the last decoded frame painted forever. That's the ghost face.
  //   - New code STOPS the camera track and replaceTrack(null)'s every
  //     video sender, so the camera light goes off, no further frames
  //     reach peers, and the remote receiver track fires `mute` (which
  //     PeerTile listens for as a belt-and-suspenders fallback to the
  //     `media-state` flag).
  //   - On ON we acquire a fresh getUserMedia, add it to localStream,
  //     re-apply background effect if active, and replaceTrack into the
  //     existing senders so we don't need renegotiation (which would be
  //     slow and racy under perfect-negotiation).
  const toggleVideo = useCallback(async () => {
    if (cameraBusyRef.current) return
    cameraBusyRef.current = true
    const dev = import.meta.env.DEV
    const log = (...args) => { if (dev) console.debug('[camera]', ...args) }
    try {
      const next = !videoOnRef.current
      log(next ? 'turning ON' : 'turning OFF', '| screenOn=', screenOn)

      if (!next) {
        // ── CAMERA OFF ────────────────────────────────────────────────
        // 1. Broadcast first. The WS roundtrip is what makes remote tiles
        //    flip to the avatar; doing it before the (cheap) track work
        //    minimizes the window where peers could still paint a frame.
        videoOnRef.current = false
        broadcastMediaState({ audio: audioOn, video: false, screen: screenOn })

        // 2. Detach video from every sender. Skip during an active screen
        //    share — those senders currently carry the SCREEN track, and
        //    nulling them would drop the share. Camera track isn't on the
        //    senders right now, just locally.
        if (!screenStreamRef.current) {
          for (const pc of Object.values(pcsRef.current)) {
            const sender = pc.__videoSender
            if (sender) {
              try { await sender.replaceTrack(null) } catch (e) { log('replaceTrack(null) failed', e) }
            }
          }
        }

        // 3. Stop AND remove the camera track from localStream. Stop alone
        //    leaves the dead track in the stream; sender.replaceTrack later
        //    could re-grab it. Both calls are idempotent.
        const ls = localStreamRef.current
        if (ls) {
          for (const t of ls.getVideoTracks()) {
            try { ls.removeTrack(t) } catch {}
            try { t.stop() } catch {}
            log('stopped local cam track', t.id)
          }
        }

        processedStreamRef.current = localStreamRef.current

        // 5. Defense in depth: explicitly clear the self <video>'s
        //    srcObject. React will unmount the element on the next render
        //    (conditional on videoOn), but nulling first stops Chromium
        //    from compositing the last frame between the state flip and
        //    the actual DOM removal.
        if (selfVideoRef.current && !screenStreamRef.current) {
          try { selfVideoRef.current.srcObject = null } catch {}
        }

        setVideoOn(false)
      } else {
        // ── CAMERA ON ─────────────────────────────────────────────────
        // Re-acquire from getUserMedia. Honour the user's current device
        // selection so toggling on after a device switch picks the right
        // camera. Use ideal-not-exact constraints so a disconnected USB
        // cam doesn't fail outright — falls back to whatever default.
        const videoConstraints = videoDeviceId
          ? { deviceId: { ideal: videoDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
        const fresh = await navigator.mediaDevices.getUserMedia({ video: videoConstraints })
        const newTrack = fresh.getVideoTracks()[0]
        if (!newTrack) throw new Error('no video track returned from getUserMedia')
        log('acquired fresh cam track', newTrack.id)

        // Splice the new track into the existing localStream so any code
        // holding the same MediaStream reference (speaker detection,
        // recording, etc.) sees the new track without re-binding.
        const ls = localStreamRef.current
        if (ls) {
          // Belt-and-braces: any lingering video track gets cleaned up so
          // we never end up with two video tracks in localStream.
          for (const t of ls.getVideoTracks()) {
            try { ls.removeTrack(t) } catch {}
            try { t.stop() } catch {}
          }
          ls.addTrack(newTrack)
        } else {
          localStreamRef.current = fresh
        }

        const outboundTrack = newTrack
        processedStreamRef.current = localStreamRef.current

        // Push to senders. During screen share, the video sender carries
        // the screen — don't clobber it. The camera will start flowing on
        // the next stopScreenShare via that path.
        if (!screenStreamRef.current) {
          for (const pc of Object.values(pcsRef.current)) {
            const sender = pc.__videoSender
            if (sender) {
              // Sender survives mute cycles thanks to the __videoSender
              // pin in createPeerConnection — just swap the track in.
              try { await sender.replaceTrack(outboundTrack) } catch (e) { log('replaceTrack(new) failed', e) }
            } else {
              // First time we're sending video on this PC (created while
              // camera was off). addTrack triggers negotiationneeded; the
              // perfect-negotiation handler takes care of the offer.
              try {
                pc.__videoSender = pc.addTrack(outboundTrack, processedStreamRef.current)
              } catch (e) { log('addTrack(new) failed', e) }
            }
          }
        }

        // Reattach self preview. The video element will mount on the next
        // render once setVideoOn(true) runs, but explicitly setting here
        // covers the case where it's already mounted (screen-sharing).
        if (selfVideoRef.current) {
          try {
            selfVideoRef.current.srcObject = null
            selfVideoRef.current.srcObject = screenStreamRef.current || processedStreamRef.current || localStreamRef.current
          } catch {}
        }

        // Speaker detection ties to the audio tracks of localStream; the
        // audio tracks didn't change so we don't strictly need this — but
        // re-attaching makes the hook re-read the (now larger) track list
        // and stay consistent. Safe to omit if it ever proves expensive.
        attachStream('self', localStreamRef.current)

        videoOnRef.current = true
        setVideoOn(true)
        broadcastMediaState({ audio: audioOn, video: true, screen: screenOn })
      }
    } catch (e) {
      console.error('[camera] toggle failed', e)
      // Resync state to whatever we actually ended up with. If we failed
      // mid-OFF, the camera might still be alive — flip the UI back so
      // the user can try again instead of being stuck.
      const stillHasVideo = !!localStreamRef.current?.getVideoTracks().length
      videoOnRef.current = stillHasVideo
      setVideoOn(stillHasVideo)
      broadcastMediaState({ audio: audioOn, video: stillHasVideo, screen: screenOn })
      setPermissionToast(`Camera toggle failed: ${e.message || e}`)
      setTimeout(() => setPermissionToast(''), 3500)
    } finally {
      cameraBusyRef.current = false
    }
  }, [audioOn, broadcastMediaState, screenOn, videoDeviceId, attachStream])

  const switchAudioDevice = async (deviceId) => {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { ...AUDIO_CONSTRAINTS_BASE, deviceId: { exact: deviceId } },
      })
      const newTrack = newStream.getAudioTracks()[0]
      const old = localStreamRef.current?.getAudioTracks()[0]
      if (old) { localStreamRef.current.removeTrack(old); old.stop() }
      localStreamRef.current.addTrack(newTrack)
      newTrack.enabled = audioOn
      attachMicEndedHandler(newTrack)
      await replaceTrackForAll(newTrack, 'audio')
      setAudioDeviceId(deviceId)
      attachStream('self', localStreamRef.current)
    } catch (e) { console.error('Failed to switch audio device', e) }
  }

  const switchVideoDevice = async (deviceId) => {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      })
      const newTrack = newStream.getVideoTracks()[0]
      const old = localStreamRef.current?.getVideoTracks()[0]
      if (old) { localStreamRef.current.removeTrack(old); old.stop() }
      localStreamRef.current.addTrack(newTrack)
      newTrack.enabled = videoOn
      processedStreamRef.current = localStreamRef.current
      await replaceTrackForAll(newTrack, 'video')
      if (selfVideoRef.current) selfVideoRef.current.srcObject = localStreamRef.current
      setVideoDeviceId(deviceId)
    } catch (e) { console.error('Failed to switch video device', e) }
  }

  // ── Screen sharing (multi-mode, multi-presenter) ──────────────────────

  const startScreenShare = useCallback(async (mode) => {
    setShowSharePicker(false)
    // Re-entry guard: a fast double-click on "share" or rapid start/stop
    // can leave senders in an undefined state. The lock makes start/stop
    // mutually exclusive without depending on React state.
    if (screenLockRef.current) return
    screenLockRef.current = true
    try {
      const constraints = { video: true, audio: true }
      // Browser handles mode selection via the native picker; we pass the
      // preferCurrentTab / selfBrowserSurface hints when available
      if (mode === 'tab') {
        constraints.video = { displaySurface: 'browser' }
        if (navigator.mediaDevices.getDisplayMedia.length !== undefined) {
          constraints.preferCurrentTab = false
          constraints.selfBrowserSurface = 'include'
        }
      } else if (mode === 'window') {
        constraints.video = { displaySurface: 'window' }
      } else {
        constraints.video = { displaySurface: 'monitor' }
      }

      const stream = await navigator.mediaDevices.getDisplayMedia(constraints)
      // Tell the encoder this is detailed/static-ish content so it preserves
      // sharp text instead of smoothing it like a face. Wrapped in try/catch
      // because contentHint is read-only in older browsers.
      const screenTrack = stream.getVideoTracks()[0]
      try { screenTrack.contentHint = 'detail' } catch {}

      screenStreamRef.current = stream

      // Swap video on every existing peer. If a sender doesn't exist yet
      // (PC built before media was ready), fall back to addTrack so the
      // screen still goes through instead of silently dropping. With perfect
      // negotiation, addTrack auto-fires onnegotiationneeded — no manual
      // createOffer loop required.
      const screenAudioTrack = stream.getAudioTracks()[0]
      for (const pc of Object.values(pcsRef.current)) {
        // Use the pinned __videoSender (set in createPeerConnection) so
        // we always reuse the same sender across mute cycles. Looking up
        // by `s.track?.kind === 'video'` would miss it whenever the camera
        // is currently off (track is null), and we'd addTrack a duplicate.
        let vSender = pc.__videoSender
        if (vSender) {
          try { await vSender.replaceTrack(screenTrack) } catch (e) { console.error('replaceTrack(screen) failed', e) }
        } else {
          try { pc.__videoSender = pc.addTrack(screenTrack, stream) } catch (e) { console.error('addTrack(screen) failed', e) }
          vSender = pc.__videoSender
        }
        // Screen content needs more bits than a talking head to stay
        // readable — keep this independent of the adaptive-quality loop.
        if (vSender) {
          try {
            const params = vSender.getParameters()
            if (!params.encodings) params.encodings = [{}]
            params.encodings[0].maxBitrate = 4_000_000
            params.encodings[0].maxFramerate = 30
            await vSender.setParameters(params)
          } catch {}
        }
        if (screenAudioTrack) {
          try { pc.addTrack(screenAudioTrack, stream) } catch {}
        }
      }

      if (selfVideoRef.current) selfVideoRef.current.srcObject = stream

      screenTrack.onended = stopScreenShare
      screenOnRef.current = true
      setScreenOn(true)
      shareModeRef.current = mode
      broadcastMediaState({ audio: audioOnRef.current, video: videoOnRef.current, screen: true })
      sendSignal({ type: 'screen-share-started', share_mode: mode })
    } catch {
      // user cancelled the picker, or getDisplayMedia rejected
    } finally {
      screenLockRef.current = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcastMediaState, sendSignal])

  const stopScreenShare = useCallback(async () => {
    if (screenLockRef.current) return
    screenLockRef.current = true
    try {
    const oldScreen = screenStreamRef.current
    // Drop the screen audio sender (if we added one) before tearing down
    // the stream — otherwise the sender lingers with a stopped track and
    // some browsers keep an extra silent receiver on the remote side.
    // onnegotiationneeded fires after removeTrack, so no manual offer needed.
    if (oldScreen) {
      const screenTrackIds = new Set(oldScreen.getTracks().map((t) => t.id))
      for (const pc of Object.values(pcsRef.current)) {
        for (const sender of pc.getSenders()) {
          if (sender.track && screenTrackIds.has(sender.track.id) && sender.track.kind === 'audio') {
            try { pc.removeTrack(sender) } catch {}
          }
        }
      }
      oldScreen.getTracks().forEach((t) => t.stop())
      screenStreamRef.current = null
    }
    const activeStream = getActiveStream()
    const camTrack = activeStream?.getVideoTracks()[0]
    // Either we have a live camera (replace senders with it) or the user
    // was sharing with camera off (replace with null so the senders don't
    // keep the now-stopped screen track painted as the last frame).
    // Use the pinned __videoSender — the screen sender IS the video sender
    // for the duration of the share.
    for (const pc of Object.values(pcsRef.current)) {
      const sender = pc.__videoSender
      if (sender) {
        try { await sender.replaceTrack(camTrack || null) } catch {}
      }
    }
    if (selfVideoRef.current) {
      try { selfVideoRef.current.srcObject = null } catch {}
      try { selfVideoRef.current.srcObject = activeStream } catch {}
    }
    // Restore the adaptive bitrate cap now that we're back to the camera.
    await applyBitrateLimit(QUALITY_PRESETS[qualityLevel])
    screenOnRef.current = false
    setScreenOn(false)
    shareModeRef.current = null
    broadcastMediaState({ audio: audioOnRef.current, video: videoOnRef.current, screen: false })
    sendSignal({ type: 'screen-share-stopped' })
    } finally {
      screenLockRef.current = false
    }
  }, [applyBitrateLimit, broadcastMediaState, getActiveStream, qualityLevel, sendSignal])

  // ── Recording ──────────────────────────────────────────────────────────

  const startRecording = useCallback(() => {
    try {
      // Combine all audio+video into a single stream for recording
      const tracks = []
      const activeStream = getActiveStream()
      if (activeStream) {
        for (const t of activeStream.getTracks()) tracks.push(t)
      }
      // Add remote peer audio tracks
      for (const pc of Object.values(pcsRef.current)) {
        const receivers = pc.getReceivers()
        for (const r of receivers) {
          if (r.track && r.track.kind === 'audio') tracks.push(r.track)
        }
      }
      if (tracks.length === 0) return

      const combinedStream = new MediaStream(tracks)
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
          ? 'video/webm;codecs=vp8,opus'
          : 'video/webm'

      const recorder = new MediaRecorder(combinedStream, { mimeType })
      recordedChunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType })
        recordedChunksRef.current = []

        // Build chat log from in-meeting chat
        const chatLog = JSON.stringify(chatMessages.map(m => ({
          name: m.name,
          body: m.body,
          time: m.created_at,
        })))

        // Upload to server
        const formData = new FormData()
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        formData.append('file', blob, `recording-${code}-${timestamp}.webm`)
        formData.append('meeting_code', code)
        formData.append('duration', String(recordingTime))
        formData.append('include_chat', chatMessages.length > 0 ? 'true' : 'false')
        if (chatMessages.length > 0) formData.append('chat_log', chatLog)

        try {
          const token = localStorage.getItem('zoiko_token')
          const res = await fetch(`${getApiBase()}/api/recordings/upload`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
          })
          if (!res.ok) console.error('Failed to upload recording')
        } catch {
          // Save locally as fallback
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `recording-${code}-${timestamp}.webm`
          a.click()
          URL.revokeObjectURL(url)
        }
      }

      recorder.start(1000) // collect data every second
      mediaRecorderRef.current = recorder
      setIsRecording(true)
      setRecordingTime(0)
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(t => t + 1)
      }, 1000)
    } catch (e) {
      console.error('Failed to start recording', e)
    }
  }, [getActiveStream, code, chatMessages, recordingTime])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current = null
    }
    setIsRecording(false)
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
  }, [])

  const formatRecTime = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0')
    const s = (secs % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  // Clean up recording on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
    }
  }, [])

  // ── Layout toggle ──────────────────────────────────────────────────────

  const toggleLayout = useCallback(() => setLayout((l) => (l === 'grid' ? 'speaker' : 'grid')), [])

  // ── Other actions ──────────────────────────────────────────────────────

  const leave = useCallback(() => {
    // Same handler-strip trick as in cleanup: prevent onclose from scheduling
    // a reconnect against the unmounted MeetRoom we're about to navigate
    // away from. close() on a stripped ws still sends the TCP FIN.
    const ws = wsRef.current
    if (ws) {
      try { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null } catch {}
      try { ws.close() } catch {}
    }
    navigate('/')
  }, [navigate])

  const sendReaction = useCallback((emoji) => {
    sendSignal({ type: 'reaction', emoji })
    const id = Math.random().toString(36).slice(2)
    setReactions((prev) => [...prev, { id, emoji, left: 10 + Math.random() * 80 }])
    setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), 2400)
    setShowEmoji(false)
  }, [sendSignal])

  // handRaised flips per toggle; using setHandRaised's functional form keeps
  // this callback stable without needing a ref. Broadcast uses the value
  // we just computed locally.
  const toggleHand = useCallback(() => {
    setHandRaised((prev) => {
      const next = !prev
      sendSignal({ type: 'raise-hand', raised: next })
      return next
    })
  }, [sendSignal])

  const sendChat = () => {
    const body = chatDraft.trim()
    if (!body) return
    sendSignal({ type: 'chat', body })
    setChatDraft('')
  }

  const [inviteCopied, setInviteCopied] = useState(false)
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/meet/${code}`)
      setInviteCopied(true)
      setTimeout(() => setInviteCopied(false), 1600)
    } catch {}
  }

  // useCallback so the reference is stable across renders — without this,
  // PeerTile.memo's shallow compare always fails on the onTogglePin prop
  // and re-renders (re-attaching srcObject) every time MeetRoom re-renders.
  const togglePin = useCallback((peerId) => {
    setPinnedPeerId((current) => {
      const next = current === peerId ? null : peerId
      // Pinning forces speaker layout for clarity; unpin leaves layout alone.
      if (next) setLayout('speaker')
      return next
    })
  }, [])

  const setPermission = (key, value) => {
    sendSignal({ type: 'set-permissions', [key]: value })
  }

  const admitUser = (userId) => sendSignal({ type: 'admit', user_id: userId })
  const admitAll = () => sendSignal({ type: 'admit-all' })
  const denyUser = (userId) => sendSignal({ type: 'deny', user_id: userId })
  const kickUser = (userId) => sendSignal({ type: 'kick', user_id: userId })
  const promoteUser = (userId) => sendSignal({ type: 'promote', user_id: userId })
  const toggleLock = () => sendSignal({ type: 'lock', locked: !meetingLocked })
  const endMeeting = () => {
    if (window.confirm('End the meeting for everyone?')) {
      sendSignal({ type: 'end-meeting' })
      navigate('/')
    }
  }

  // ── Derived values ─────────────────────────────────────────────────────

  // A peer without a name is a ghost (e.g., a media-state arrived for a
  // peer-id we never learned about, or a stale entry from before reconnect).
  // Filtering here keeps the grid clean even if upstream invariants slip.
  const peerList = useMemo(
    () => Object.values(peers).filter((p) => p && p.name && p.peer_id),
    [peers]
  )
  const tileCount = peerList.length + 1
  const speakerPeer = useMemo(() => {
    // Pin (manual) wins over auto active-speaker. 'self' is handled by caller.
    if (pinnedPeerId && pinnedPeerId !== 'self') {
      const pinned = peerList.find((p) => p.peer_id === pinnedPeerId)
      if (pinned) return pinned
    }
    if (pinnedPeerId === 'self') return null
    if (activeSpeaker === 'self') return null
    return peerList.find((p) => p.peer_id === activeSpeaker) || peerList[0] || null
  }, [activeSpeaker, peerList, pinnedPeerId])

  // Active presenter drives the Google Meet–style presentation layout.
  // Self wins when screenOn; otherwise the first peer flagged as sharing.
  // `media-state` is the single source of truth for peer.screen, so this
  // updates automatically as shares start and stop.
  const activePresenter = useMemo(() => {
    if (screenOn) return { peer_id: 'self', isSelf: true, peer: null }
    const sharing = peerList.find((p) => p.screen)
    if (sharing) return { peer_id: sharing.peer_id, isSelf: false, peer: sharing }
    return null
  }, [screenOn, peerList])
  const isPresentation = !!activePresenter

  if (err) {
    const isTerminal = err.startsWith('Session expired')
      || err.startsWith('Meeting has ended')
      || err.startsWith('You have been')
      || err.startsWith('This meeting is locked')
      || err.startsWith('The host has ended')
    return (
      <div className="grid min-h-screen w-screen place-items-center bg-[#0f1217] p-6 text-zinc-100">
        <div className="max-w-md text-center">
          <p className="mb-6 text-base leading-relaxed text-zinc-300">{err}</p>
          <div className="flex justify-center gap-3">
            {!isTerminal && (
              <button
                onClick={() => window.location.reload()}
                className="rounded-full bg-zinc-800 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
              >Try again</button>
            )}
            <button
              onClick={() => navigate('/')}
              className="rounded-full bg-[#1a73e8] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#1765c1]"
            >Back home</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Layouts ────────────────────────────────────────────────────────────

  const selfInitial = (user.name || '?').trim().charAt(0).toUpperCase() || '?'
  const selfBg = user.avatar_color || '#3a6ff3'

  const SelfTile = ({ size }) => {
    const showVideo = videoOn || screenOn
    const isSpotlight = size === 'spotlight'
    const isMini = size === 'mini'
    const speaking = speakingPeers.has('self')
    return (
      <div
        className={
          'relative isolate flex h-full w-full overflow-hidden rounded-2xl bg-[#3c4043] ' +
          (speaking ? 'ring-2 ring-[#8ab4f8]' : 'ring-1 ring-white/5')
        }
      >
        {showVideo ? (
          <video
            ref={attachSelfVideoEl}
            autoPlay
            playsInline
            muted
            className={
              'absolute inset-0 h-full w-full ' +
              (screenOn ? 'object-contain bg-black' : 'object-cover -scale-x-100')
            }
          />
        ) : (
          // Same colored-gradient treatment as PeerTile so self looks like
          // any other tile when the camera is off.
          <div
            className="absolute inset-0 grid place-items-center"
            style={{
              background: `radial-gradient(circle at 50% 35%, ${selfBg} 0%, color-mix(in srgb, ${selfBg} 55%, #000) 100%)`,
            }}
          >
            <div
              className={
                'grid place-items-center rounded-full font-semibold text-white ring-1 ring-white/15 backdrop-blur-sm bg-white/[0.08] ' +
                (isSpotlight ? 'h-36 w-36 text-5xl' : isMini ? 'h-10 w-10 text-base' : 'h-24 w-24 text-3xl')
              }
            >{selfInitial}</div>
          </div>
        )}

        {handRaised && !isMini && (
          <div className="absolute left-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-amber-400 text-zinc-900 shadow-md">
            <Hand className="h-4 w-4" />
          </div>
        )}

        {/* Self mic-off badge — top-right like Meet */}
        {!audioOn && !isMini && (
          <div className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm" title="You are muted">
            <MicOff className="h-3.5 w-3.5 text-[#ea4335]" />
          </div>
        )}

        {!isMini && (
          <button
            onClick={() => togglePin('self')}
            className={
              'absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full transition ' +
              (pinnedPeerId === 'self'
                ? 'bg-[#8ab4f8]/20 text-[#8ab4f8] opacity-100'
                : 'bg-black/55 text-white/85 opacity-0 backdrop-blur hover:bg-black/70 group-hover/tile:opacity-100')
            }
            title={pinnedPeerId === 'self' ? 'Unpin' : 'Pin to main view'}
            aria-label="Pin"
          >
            <Pin className="h-4 w-4" />
          </button>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
          <div className="flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
            <span className="truncate">{user.name} (You){screenOn ? ' · Presenting' : ''}</span>
            {isHost && <Crown className="h-3 w-3 text-amber-300" />}
            {!isHost && myRole === 'co_host' && <ShieldCheck className="h-3 w-3 text-cyan-300" />}
          </div>
          {!audioOn && (
            <div className="grid h-7 w-7 place-items-center rounded-full bg-[#ea4335] text-white shadow">
              <MicOff className="h-3.5 w-3.5" />
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderSpeakerView = () => {
    const isSelfSpeaker = pinnedPeerId === 'self'
      || (!pinnedPeerId && (!speakerPeer || activeSpeaker === 'self'))
    const thumbnailPeers = isSelfSpeaker ? peerList : peerList.filter((p) => p.peer_id !== speakerPeer?.peer_id)
    return (
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="group/tile relative min-h-0 flex-1">
          {isSelfSpeaker ? <SelfTile size="spotlight" /> : (
            <PeerTile
              peer={speakerPeer}
              spotlight
              speaking={speakingPeers.has(speakerPeer.peer_id)}
              pinned={pinnedPeerId === speakerPeer.peer_id}
              onTogglePin={togglePin}
            />
          )}
        </div>
        <div className="flex shrink-0 gap-2 overflow-x-auto pb-1">
          {!isSelfSpeaker && (
            <div className="group/tile relative h-28 w-44 shrink-0">
              <SelfTile size="mini" />
            </div>
          )}
          {thumbnailPeers.map((p) => (
            <div key={p.peer_id} className="group/tile relative h-28 w-44 shrink-0">
              <PeerTile
                peer={p}
                mini
                speaking={speakingPeers.has(p.peer_id)}
                pinned={pinnedPeerId === p.peer_id}
                onTogglePin={togglePin}
              />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const gridColsFor = (n) => {
    if (n <= 1) return 'grid-cols-1'
    if (n <= 2) return 'grid-cols-1 sm:grid-cols-2'
    if (n <= 4) return 'grid-cols-2'
    if (n <= 6) return 'grid-cols-2 lg:grid-cols-3'
    if (n <= 9) return 'grid-cols-2 sm:grid-cols-3'
    return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
  }
  const maxWidthFor = (n) => {
    if (n <= 1) return 'max-w-4xl'
    if (n <= 4) return 'max-w-6xl'
    return 'max-w-none'
  }

  const renderGridView = () => (
    <div className={`mx-auto h-full w-full ${maxWidthFor(tileCount)} p-4`}>
      <div className={`grid h-full auto-rows-fr gap-3 ${gridColsFor(tileCount)}`}>
        <div className="group/tile relative">
          <SelfTile />
        </div>
        {peerList.map((p) => (
          <div key={p.peer_id} className="group/tile relative">
            <PeerTile
              peer={p}
              speaking={speakingPeers.has(p.peer_id)}
              pinned={pinnedPeerId === p.peer_id}
              onTogglePin={() => togglePin(p.peer_id)}
            />
          </div>
        ))}
      </div>
    </div>
  )

  // Google Meet–style presentation layout. Triggered automatically when
  // someone (self or peer) flips their `screen` flag on. The shared content
  // dominates the stage; everyone else collapses into a side rail on desktop
  // or a bottom strip on tablet/mobile. Stable keys (`peer_id`) on each
  // filmstrip wrapper keep React from re-mounting tiles when the active
  // speaker changes — that's what prevents the jumpy / flicker behavior the
  // old layout had during shares.
  const renderPresentationView = () => {
    const presenter = activePresenter
    const isSelfPresenter = presenter.isSelf
    const presenterPeer = presenter.peer
    // Filmstrip = everyone except the presenter. When self is presenting,
    // the hero already shows our screen — don't also render a self filmstrip
    // tile (would double-attach selfVideoRef AND duplicate the share visually).
    const stripPeers = peerList.filter((p) => p.peer_id !== (presenterPeer ? presenterPeer.peer_id : ''))
    const showSelfInStrip = !isSelfPresenter

    return (
      <div className="zk-stage-presentation flex h-full min-h-0 flex-col gap-3 p-3 sm:p-4 lg:flex-row">
        {/* ── Hero (shared content) ─────────────────────────────── */}
        <div className="group/tile zk-stage-hero relative min-h-0 min-w-0 flex-1">
          {isSelfPresenter ? (
            <SelfTile size="spotlight" />
          ) : (
            <PeerTile
              peer={presenterPeer}
              spotlight
              speaking={speakingPeers.has(presenterPeer.peer_id)}
              pinned={pinnedPeerId === presenterPeer.peer_id}
              onTogglePin={togglePin}
            />
          )}
        </div>

        {/* ── Filmstrip ─────────────────────────────────────────── */}
        {/* Row on tablet/mobile, vertical rail on desktop. The single
            container handles both via flex direction breakpoint. */}
        <div
          className={
            'zk-filmstrip flex shrink-0 gap-2 ' +
            'overflow-x-auto overflow-y-hidden ' +
            'lg:max-h-full lg:w-[260px] lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:pr-1'
          }
        >
          {showSelfInStrip && (
            <div className="group/tile zk-strip-tile relative h-24 w-40 shrink-0 lg:h-auto lg:w-full lg:aspect-video">
              <SelfTile size="mini" />
            </div>
          )}
          {stripPeers.map((p) => (
            <div
              key={p.peer_id}
              className="group/tile zk-strip-tile relative h-24 w-40 shrink-0 lg:h-auto lg:w-full lg:aspect-video"
            >
              <PeerTile
                peer={p}
                mini
                speaking={speakingPeers.has(p.peer_id)}
                pinned={pinnedPeerId === p.peer_id}
                onTogglePin={togglePin}
              />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const sidebarTitle = sidebar === 'chat' ? 'In-call messages'
    : sidebar === 'people' ? `People · ${tileCount}`
    : sidebar === 'settings' ? 'Settings'
    : ''

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-[#202124] text-zinc-100">
      {/* ── Top bar ──────────────────────────────────────────────── */}
      {/* No border / no background — sits transparently over the stage like
          Meet does. Recording / lock pills float on the left, code + copy
          link float on the right. */}
      <header className="flex h-14 shrink-0 items-center justify-between px-4">
        <div className="flex items-center gap-2.5 text-sm">
          {isRecording && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ea4335]/15 px-2.5 py-1 text-[11px] font-semibold text-[#ea4335]">
              <span className="relative grid h-1.5 w-1.5 place-items-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
              </span>
              REC {formatRecTime(recordingTime)}
            </span>
          )}
          {meetingLocked && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-400" title="Meeting is locked">
              <Lock className="h-3 w-3" /> Locked
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] tracking-wide text-zinc-300">{code}</span>
          <button
            onClick={copyInvite}
            title="Copy invite link"
            aria-label="Copy invite link"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 text-[12px] font-medium text-zinc-200 transition hover:bg-white/10"
          >
            {inviteCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {inviteCopied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </header>

      {/* ── Main stage + side panel ─────────────────────────────── */}
      <main className="relative flex min-h-0 flex-1 overflow-hidden">
        <div
          key={isPresentation ? 'present' : (layout === 'speaker' ? 'speaker' : 'grid')}
          className="zk-stage-fade min-w-0 flex-1"
        >
          {isPresentation
            ? renderPresentationView()
            : layout === 'speaker' && peerList.length > 0
              ? renderSpeakerView()
              : renderGridView()}
        </div>

        {sidebar && (
          <aside className="m-2 flex h-[calc(100%-1rem)] w-[340px] shrink-0 flex-col overflow-hidden rounded-2xl bg-[#2a2c2f] shadow-lg ring-1 ring-white/5">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/5 px-4">
              <h2 className="text-[15px] font-medium text-zinc-100">{sidebarTitle}</h2>
              <button
                onClick={() => setSidebar(null)}
                className="grid h-8 w-8 place-items-center rounded-full text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
                aria-label="Close panel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {sidebar === 'chat' && (
              <>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
                  {chatMessages.length === 0 && (
                    <p className="px-2 py-6 text-center text-[13px] text-zinc-500">
                      Messages can be seen only by people in the call and are deleted when the call ends.
                    </p>
                  )}
                  {chatMessages.map((m, i) => (
                    <div key={i} className="text-[13px]">
                      <div className="mb-0.5 flex items-baseline gap-2">
                        <span className="font-semibold text-zinc-100" style={{ color: m.color }}>{m.name}</span>
                        <span className="text-[11px] text-zinc-500">
                          {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="rounded-2xl rounded-tl-md bg-white/[0.04] px-3 py-2 leading-snug text-zinc-200">{m.body}</div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                {(() => {
                  const chatBlocked = !chatEnabled && !isHostOrCohost
                  return (
                    <div className="shrink-0 border-t border-white/5 p-3">
                      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 focus-within:border-[#8ab4f8]/60">
                        <input
                          placeholder={chatBlocked ? 'Chat is disabled by the host' : 'Send a message'}
                          value={chatDraft}
                          onChange={(e) => setChatDraft(e.target.value)}
                          disabled={chatBlocked}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendChat() } }}
                          className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 outline-none disabled:cursor-not-allowed"
                        />
                        <button
                          onClick={sendChat}
                          disabled={chatBlocked || !chatDraft.trim()}
                          aria-label="Send"
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#8ab4f8] transition enabled:hover:bg-[#8ab4f8]/15 disabled:opacity-40"
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )
                })()}
              </>
            )}

            {sidebar === 'people' && (
              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                {isHostOrCohost && waitingList.length > 0 && (
                  <div className="mb-3 rounded-xl bg-amber-500/[0.06] p-2 ring-1 ring-amber-400/15">
                    <div className="flex items-center justify-between px-2 py-1">
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-amber-300">
                        <Clock className="h-3 w-3" /> Waiting · {waitingList.length}
                      </span>
                      <button
                        onClick={admitAll}
                        className="rounded-full px-2 py-1 text-[11.5px] font-medium text-amber-200 hover:bg-amber-400/10"
                      >Admit all</button>
                    </div>
                    {waitingList.map((w) => (
                      <ParticipantRow
                        key={w.user_id}
                        name={w.name}
                        color={w.color}
                        actions={
                          <>
                            <button
                              onClick={() => admitUser(w.user_id)}
                              title="Admit"
                              className="grid h-7 w-7 place-items-center rounded-full text-emerald-400 hover:bg-emerald-400/15"
                            ><Check className="h-3.5 w-3.5" /></button>
                            <button
                              onClick={() => denyUser(w.user_id)}
                              title="Deny"
                              className="grid h-7 w-7 place-items-center rounded-full text-[#ea4335] hover:bg-[#ea4335]/15"
                            ><X className="h-3.5 w-3.5" /></button>
                          </>
                        }
                      />
                    ))}
                  </div>
                )}

                <div className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  In the meeting
                </div>

                <ParticipantRow
                  name={`${user.name} (You)`}
                  color={user.avatar_color}
                  role={isHost ? 'host' : myRole === 'co_host' ? 'co_host' : null}
                  states={{ audio: audioOn, video: videoOn, screen: screenOn, hand: handRaised }}
                />

                {peerList.map((p) => (
                  <ParticipantRow
                    key={p.peer_id}
                    name={p.name}
                    color={p.color}
                    role={p.role}
                    states={{ audio: p.audio !== false, video: p.video !== false, screen: !!p.screen, hand: !!p.hand }}
                    actions={isHostOrCohost && p.user_id ? (
                      <>
                        {isHost && (
                          <button
                            onClick={() => promoteUser(p.user_id)}
                            title={p.role === 'co_host' ? 'Remove co-host' : 'Make co-host'}
                            className="grid h-7 w-7 place-items-center rounded-full text-zinc-300 hover:bg-white/10"
                          ><ShieldCheck className="h-3.5 w-3.5" /></button>
                        )}
                        <button
                          onClick={() => kickUser(p.user_id)}
                          title="Remove from meeting"
                          className="grid h-7 w-7 place-items-center rounded-full text-[#ea4335] hover:bg-[#ea4335]/15"
                        ><PhoneOff className="h-3.5 w-3.5" /></button>
                      </>
                    ) : null}
                  />
                ))}

                {isHostOrCohost && (
                  <div className="mt-4 space-y-1 border-t border-white/5 px-1 pt-3">
                    <HostButton
                      active={meetingLocked}
                      onClick={toggleLock}
                      icon={<Lock className="h-4 w-4" />}
                      label={meetingLocked ? 'Unlock meeting' : 'Lock meeting'}
                    />
                    <HostButton
                      active={!chatEnabled}
                      onClick={() => setPermission('chat_enabled', !chatEnabled)}
                      icon={<MessageSquare className="h-4 w-4" />}
                      label={chatEnabled ? 'Disable participant chat' : 'Enable participant chat'}
                    />
                    <HostButton
                      active={!screenshareEnabled}
                      onClick={() => setPermission('screenshare_enabled', !screenshareEnabled)}
                      icon={<MonitorUp className="h-4 w-4" />}
                      label={screenshareEnabled ? 'Disable participant screen share' : 'Enable participant screen share'}
                    />
                    {isHost && (
                      <button
                        onClick={endMeeting}
                        className="mt-2 flex w-full items-center gap-3 rounded-xl bg-[#ea4335] px-3 py-2.5 text-sm font-medium text-white transition hover:bg-[#d33b2c]"
                      >
                        <PhoneOff className="h-4 w-4" /> End meeting for all
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {sidebar === 'settings' && (
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Camera</label>
                  <select
                    value={videoDeviceId}
                    onChange={(e) => switchVideoDevice(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 focus:border-[#8ab4f8]/60 focus:outline-none"
                  >
                    {devices.video.length === 0 && <option value="">No cameras found</option>}
                    {devices.video.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 8)}`}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Microphone</label>
                  <select
                    value={audioDeviceId}
                    onChange={(e) => switchAudioDevice(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 focus:border-[#8ab4f8]/60 focus:outline-none"
                  >
                    {devices.audio.length === 0 && <option value="">No microphones found</option>}
                    {devices.audio.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0, 8)}`}</option>
                    ))}
                  </select>
                </div>
                <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Stream quality</div>
                  <div className="flex items-center gap-2 text-sm text-zinc-200">
                    <span className={
                      'inline-block h-2 w-2 rounded-full ' +
                      (qualityLevel === 'high' ? 'bg-emerald-400' : qualityLevel === 'medium' ? 'bg-amber-400' : 'bg-[#ea4335]')
                    } />
                    {qualityLevel === 'high' ? '720p HD' : qualityLevel === 'medium' ? '480p SD' : '240p'}
                    <span className="ml-1 text-[11.5px] text-zinc-500">(adapts to network)</span>
                  </div>
                </div>
              </div>
            )}
          </aside>
        )}
      </main>

      {/* ── Bottom dock ─────────────────────────────────────────── */}
      <MeetingDock
        clock={clock}
        code={code}
        audioOn={audioOn}
        toggleAudio={toggleAudio}
        audioDeviceMenu={
          devices.audio.length > 1
            ? ({ close }) => (
                <DockDeviceMenu
                  title="Microphone"
                  devices={devices.audio}
                  current={audioDeviceId}
                  onPick={async (id) => { await switchAudioDevice(id); close() }}
                />
              )
            : null
        }
        videoOn={videoOn}
        toggleVideo={toggleVideo}
        videoDeviceMenu={
          devices.video.length > 1
            ? ({ close }) => (
                <DockDeviceMenu
                  title="Camera"
                  devices={devices.video}
                  current={videoDeviceId}
                  onPick={async (id) => { await switchVideoDevice(id); close() }}
                />
              )
            : null
        }
        screenOn={screenOn}
        screenshareEnabled={screenshareEnabled}
        isHostOrCohost={isHostOrCohost}
        showSharePicker={showSharePicker}
        setShowSharePicker={setShowSharePicker}
        startScreenShare={startScreenShare}
        stopScreenShare={stopScreenShare}
        isRecording={isRecording}
        startRecording={startRecording}
        stopRecording={stopRecording}
        handRaised={handRaised}
        toggleHand={toggleHand}
        showEmoji={showEmoji}
        setShowEmoji={setShowEmoji}
        sendReaction={sendReaction}
        layout={layout}
        toggleLayout={toggleLayout}
        sidebar={sidebar}
        setSidebar={setSidebar}
        waitingList={waitingList}
        leave={leave}
      />

      {/* ── Reactions overlay ───────────────────────────────────── */}
      {reactions.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
          {reactions.map((r) => (
            <span
              key={r.id}
              className="zk-reaction-rise absolute bottom-24 select-none text-4xl"
              style={{ left: `${r.left}%` }}
            >{r.emoji}</span>
          ))}
        </div>
      )}

      {/* ── Toast ───────────────────────────────────────────────── */}
      {permissionToast && (
        <div
          role="alert"
          className="pointer-events-none absolute left-1/2 top-20 z-40 -translate-x-1/2 rounded-full bg-zinc-900/95 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/10 shadow-lg"
        >{permissionToast}</div>
      )}
    </div>
  )
}

function ParticipantRow({ name, color, role, states, actions }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?'
  return (
    <div className="group flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-white/[0.04]">
      <div
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white"
        style={{ backgroundColor: color || '#3a6ff3' }}
      >{initial}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 truncate text-[13px] font-medium text-zinc-100">
          <span className="truncate">{name}</span>
          {role === 'host' && <Crown className="h-3 w-3 shrink-0 text-amber-300" title="Host" />}
          {role === 'co_host' && <ShieldCheck className="h-3 w-3 shrink-0 text-cyan-300" title="Co-host" />}
        </div>
      </div>
      {states && (
        <div className="flex items-center gap-1 text-zinc-400">
          {states.hand && <Hand className="h-3.5 w-3.5 text-amber-300" />}
          {states.screen && <MonitorUp className="h-3.5 w-3.5 text-[#8ab4f8]" />}
          {!states.audio && <MicOff className="h-3.5 w-3.5 text-[#ea4335]" />}
          {!states.video && <VideoOff className="h-3.5 w-3.5 text-zinc-500" />}
        </div>
      )}
      {actions && <div className="ml-1 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">{actions}</div>}
    </div>
  )
}

function HostButton({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className={
        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ' +
        (active ? 'bg-[#8ab4f8]/15 text-[#8ab4f8]' : 'text-zinc-200 hover:bg-white/[0.05]')
      }
    >
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.04]">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  )
}

/**
 * Compact device-picker dropdown that hangs off the dock's mic/camera
 * caret. The dock owns the popover positioning + outside-click handling;
 * this component just renders the list. Returning early on a no-op pick
 * keeps the menu from triggering an unnecessary `getUserMedia` (and the
 * permission re-prompt that some Chromium builds throw on it).
 */
function DockDeviceMenu({ title, devices, current, onPick }) {
  return (
    <div className="py-1.5">
      <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </div>
      <ul className="max-h-[260px] overflow-y-auto">
        {devices.map((d) => {
          const active = d.deviceId === current
          return (
            <li key={d.deviceId}>
              <button
                onClick={() => { if (!active) onPick(d.deviceId) }}
                className={
                  'flex w-full items-start gap-2.5 px-3 py-2 text-left text-[13px] transition ' +
                  (active
                    ? 'bg-[#8ab4f8]/12 text-[#8ab4f8]'
                    : 'text-zinc-100 hover:bg-white/[0.06]')
                }
              >
                <span className="mt-1 grid h-2 w-2 shrink-0 place-items-center">
                  {active && <span className="h-2 w-2 rounded-full bg-current" />}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {d.label || `${title} ${d.deviceId.slice(0, 6)}`}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// PeerTile is now imported from ../components/meeting/PeerTile
