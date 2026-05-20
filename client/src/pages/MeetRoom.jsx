import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getApiBase, getWsBase } from '../api/client'
import { useAuth } from '../context/AuthContext'
import Avatar from '../components/Avatar'
import Icon from '../components/Icon'
// Heavy panels that are off-screen by default — defer their JS until the
// user actually opens them. Saves ~10-20 KB on initial MeetRoom load and
// avoids paying for canvas/AI-panel deps just to enter a meeting. The
// `null` fallback means the overlay simply doesn't appear for the ~50 ms
// it takes the chunk to load — invisible to the user.
const _Whiteboard = lazy(() => import('../components/Whiteboard'))
const _AnnotationOverlay = lazy(() => import('../components/AnnotationOverlay'))
const _AIChatPanel = lazy(() => import('../components/AIChatPanel'))
const Whiteboard = (props) => (
  <Suspense fallback={null}><_Whiteboard {...props} /></Suspense>
)
const AnnotationOverlay = (props) => (
  <Suspense fallback={null}><_AnnotationOverlay {...props} /></Suspense>
)
const AIChatPanel = (props) => (
  <Suspense fallback={null}><_AIChatPanel {...props} /></Suspense>
)
import useSpeakerDetection from '../hooks/useSpeakerDetection'
import useMediaDevices from '../hooks/useMediaDevices'
import useBackgroundEffect from '../hooks/useBackgroundEffect'
import useNoiseSuppression from '../hooks/useNoiseSuppression'
import MeetingDock from '../components/meeting/MeetingDock'
import PeerTile from '../components/meeting/PeerTile'
import Logo from '../components/ui/Logo'
import ThemeToggle from '../components/ui/ThemeToggle'
import Badge from '../components/ui/Badge'
import { Check, Copy as CopyIcon, Lock as LockIcon, MonitorUp as ShareIcon, Radio as RecIcon } from 'lucide-react'
import './Meet.css'
import './MeetRoom.theme.css'

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

const QUALITY_PRESETS = {
  high:   { width: 1280, height: 720,  frameRate: 30, maxBitrate: 2_500_000 },
  medium: { width: 640,  height: 480,  frameRate: 24, maxBitrate: 1_000_000 },
  low:    { width: 320,  height: 240,  frameRate: 15, maxBitrate: 500_000 },
}

export default function MeetRoom() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [, setSelf] = useState(null)
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
  const [meetingInfo, setMeetingInfo] = useState(null)
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

  // AI recap modal
  const [recapText, setRecapText] = useState('')
  const [recapLoading, setRecapLoading] = useState(false)
  const [recapOpen, setRecapOpen] = useState(false)
  const [intelLoading, setIntelLoading] = useState(false)

  // Live captions (browser SpeechRecognition; broadcast finals to peers)
  const [captionsOn, setCaptionsOn] = useState(false)
  const [myCaption, setMyCaption] = useState('')
  // peer_id -> { name, color, text, ts }
  const [peerCaptions, setPeerCaptions] = useState({})
  const recognitionRef = useRef(null)
  const captionExpiryRef = useRef(null)

  // Video/audio feature state
  const [layout, setLayout] = useState('grid')
  const [activeSpeaker, setActiveSpeaker] = useState(null)
  const [speakingPeers, setSpeakingPeers] = useState(new Set())
  const [bgMode, setBgMode] = useState('none')
  const [noiseSupp, setNoiseSupp] = useState(false)
  const [qualityLevel, setQualityLevel] = useState('high')

  // Collaboration state
  const [showWhiteboard, setShowWhiteboard] = useState(false)
  const [remoteWbStrokes, setRemoteWbStrokes] = useState([])
  const [showAnnotations, setShowAnnotations] = useState(false)
  const [remoteAnnotations, setRemoteAnnotations] = useState([])
  const [showSharePicker, setShowSharePicker] = useState(false)
  const [, setShareMode] = useState(null) // 'screen' | 'window' | 'tab'
  const [screenSharers, setScreenSharers] = useState({}) // { peerId: { name, share_mode } }

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

  const isHostOrCohost = isHost || myRole === 'co_host'

  const { devices, audioDeviceId, setAudioDeviceId, videoDeviceId, setVideoDeviceId } = useMediaDevices()
  const bgEffect = useBackgroundEffect()
  const noiseSuppHook = useNoiseSuppression()

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
  const attachSelfVideoEl = useCallback((el) => {
    selfVideoRef.current = el
    if (!el) return
    const stream = screenStreamRef.current || processedStreamRef.current || localStreamRef.current
    if (stream && el.srcObject !== stream) el.srcObject = stream
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
    if (pc) { try { pc.close() } catch {}; delete pcsRef.current[peerId] }
    delete pendingIceRef.current[peerId]
    detachStream(peerId)
    setPeers((prev) => { const next = { ...prev }; delete next[peerId]; return next })
    setScreenSharers((prev) => { const next = { ...prev }; delete next[peerId]; return next })
  }, [detachStream])

  const sendSignal = useCallback((payload) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload))
  }, [])

  const broadcastMediaState = useCallback((state) => {
    sendSignal({ type: 'media-state', audio: state.audio, video: state.video, screen: state.screen })
  }, [sendSignal])

  // ── Adaptive bitrate ───────────────────────────────────────────────────

  const applyBitrateLimit = useCallback(async (preset) => {
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
    const stream = getActiveStream()
    if (stream) { for (const track of stream.getTracks()) pc.addTrack(track, stream) }

    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal({ type: 'ice-candidate', target: remotePeerId, payload: e.candidate.toJSON() })
    }
    pc.ontrack = (e) => {
      const [remoteStream] = e.streams
      updatePeer(remotePeerId, { ...(remoteInfo || {}), peer_id: remotePeerId, stream: remoteStream })
      attachStream(remotePeerId, remoteStream)
    }
    pc.onconnectionstatechange = () => {}
    pcsRef.current[remotePeerId] = pc
    applyBitrateLimit(QUALITY_PRESETS[qualityLevel])
    return pc
  }, [sendSignal, updatePeer, getActiveStream, attachStream, applyBitrateLimit, qualityLevel])

  const negotiate = useCallback(async (remotePeerId, remoteInfo) => {
    const pc = createPeerConnection(remotePeerId, remoteInfo)
    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      sendSignal({ type: 'offer', target: remotePeerId, payload: offer })
    } catch (e) { console.error('negotiate failed', e) }
  }, [createPeerConnection, sendSignal])

  const handleOffer = useCallback(async (fromPeerId, fromName, payload) => {
    const pc = createPeerConnection(fromPeerId, { name: fromName })
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(payload))
      const pending = pendingIceRef.current[fromPeerId] || []
      for (const c of pending) { try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {} }
      pendingIceRef.current[fromPeerId] = []
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      sendSignal({ type: 'answer', target: fromPeerId, payload: answer })
    } catch (e) { console.error('handleOffer failed', e) }
  }, [createPeerConnection, sendSignal])

  const handleAnswer = useCallback(async (fromPeerId, payload) => {
    const pc = pcsRef.current[fromPeerId]
    if (!pc) return
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(payload))
      const pending = pendingIceRef.current[fromPeerId] || []
      for (const c of pending) { try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {} }
      pendingIceRef.current[fromPeerId] = []
    } catch (e) { console.error('handleAnswer failed', e) }
  }, [])

  const handleIce = useCallback(async (fromPeerId, candidate) => {
    const pc = pcsRef.current[fromPeerId]
    if (!pc || !pc.remoteDescription) {
      pendingIceRef.current[fromPeerId] = [...(pendingIceRef.current[fromPeerId] || []), candidate]
      return
    }
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) } catch (e) { console.error('addIceCandidate failed', e) }
  }, [])

  const replaceTrackForAll = useCallback(async (newTrack, kind = 'video') => {
    for (const pc of Object.values(pcsRef.current)) {
      const sender = pc.getSenders().find((s) => s.track?.kind === kind)
      if (sender) { try { await sender.replaceTrack(newTrack) } catch {} }
    }
  }, [])

  // ── WebSocket connect ──────────────────────────────────────────────────

  const connectWs = useCallback(() => {
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
        setSelf(data.self)
        setIsHost(data.is_host)
        setMyRole(data.role || 'participant')
        if (data.meeting) {
          setMeetingInfo(data.meeting)
          setMeetingLocked(data.meeting.locked || false)
          setChatEnabled(data.meeting.chat_enabled !== false)
          setScreenshareEnabled(data.meeting.screenshare_enabled !== false)
        }
        const prefs = JSON.parse(sessionStorage.getItem(`zoiko_meet_prefs_${code}`) || '{}')
        for (const p of data.peers) {
          updatePeer(p.peer_id, p)
          if (data.self.peer_id < p.peer_id) await negotiate(p.peer_id, p)
        }
        broadcastMediaState({ audio: prefs.audio !== false, video: prefs.video !== false, screen: false })
      } else if (data.type === 'peer-joined') {
        updatePeer(data.peer.peer_id, data.peer)
        setSelf((current) => {
          if (current && current.peer_id < data.peer.peer_id) negotiate(data.peer.peer_id, data.peer)
          return current
        })
      } else if (data.type === 'peer-left') {
        removePeer(data.peer_id)
      } else if (data.type === 'offer') {
        await handleOffer(data.from, data.from_user, data.payload)
      } else if (data.type === 'answer') {
        await handleAnswer(data.from, data.payload)
      } else if (data.type === 'ice-candidate') {
        await handleIce(data.from, data.payload)
      } else if (data.type === 'media-state') {
        updatePeer(data.peer_id, { audio: data.audio, video: data.video, screen: data.screen })
      } else if (data.type === 'chat') {
        setChatMessages((prev) => [...prev, data])
      } else if (data.type === 'reaction') {
        const id = Math.random().toString(36).slice(2)
        setReactions((prev) => [...prev, { id, emoji: data.emoji, left: 10 + Math.random() * 80 }])
        setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), 2400)
      } else if (data.type === 'raise-hand') {
        updatePeer(data.peer_id, { hand: data.raised })
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
      } else if (data.type === 'caption') {
        const ts = Date.now()
        setPeerCaptions((prev) => ({
          ...prev,
          [data.peer_id]: { name: data.name, color: data.color, text: data.text, ts },
        }))
      } else if (data.type === 'meeting-ended') {
        setErr('The host has ended this meeting.')
      } else if (data.type === 'kicked') {
        setErr('You have been removed from this meeting.')
      }

      // ── Collaboration events ────────────────────────────────────────
      else if (data.type === 'wb-stroke') {
        setRemoteWbStrokes(prev => [...prev, data.stroke])
      } else if (data.type === 'wb-clear') {
        setRemoteWbStrokes(prev => [...prev, { tool: 'clear' }])
      } else if (data.type === 'annotation') {
        setRemoteAnnotations(prev => [...prev, data.annotation])
      } else if (data.type === 'annotation-clear') {
        setRemoteAnnotations(prev => [...prev, { tool: 'clear' }])
      } else if (data.type === 'screen-share-started') {
        setScreenSharers(prev => ({
          ...prev,
          [data.peer_id]: { name: data.name, share_mode: data.share_mode },
        }))
      } else if (data.type === 'screen-share-stopped') {
        setScreenSharers(prev => {
          const next = { ...prev }
          delete next[data.peer_id]
          return next
        })
      }
    }

    ws.onclose = (ev) => {
      if (ev.code === 4401) setErr('Session expired, please sign in again.')
      else if (ev.code === 4404) setErr('Meeting has ended.')
      else if (ev.code === 4403) setErr('You have been denied entry to this meeting.')
      else if (ev.code === 4423) setErr('This meeting is locked.')
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
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        if (prefs.audio === false) { stream.getAudioTracks().forEach((t) => (t.enabled = false)); setAudioOn(false) }
        if (prefs.video === false) { stream.getVideoTracks().forEach((t) => (t.enabled = false)); setVideoOn(false) }
        localStreamRef.current = stream
        processedStreamRef.current = stream
        if (selfVideoRef.current) selfVideoRef.current.srcObject = stream
        attachStream('self', stream)
        connectWs()
      } catch (e) { setErr(e.message || 'Could not start meeting') }
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
      try { wsRef.current?.close() } catch {}
      for (const pc of Object.values(pcsRef.current)) { try { pc.close() } catch {} }
      pcsRef.current = {}
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach((t) => t.stop())
      if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach((t) => t.stop())
      bgEffect.stopEffect()
      noiseSuppHook.disable()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  // ── Media controls ─────────────────────────────────────────────────────

  const toggleAudio = () => {
    if (!localStreamRef.current) return
    const next = !audioOn
    localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = next))
    if (processedStreamRef.current && processedStreamRef.current !== localStreamRef.current)
      processedStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = next))
    setAudioOn(next)
    broadcastMediaState({ audio: next, video: videoOn, screen: screenOn })
  }

  const toggleVideo = () => {
    if (!localStreamRef.current) return
    const next = !videoOn
    localStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = next))
    if (processedStreamRef.current && processedStreamRef.current !== localStreamRef.current)
      processedStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = next))
    setVideoOn(next)
    broadcastMediaState({ audio: audioOn, video: next, screen: screenOn })
  }

  const switchAudioDevice = async (deviceId) => {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      const newTrack = newStream.getAudioTracks()[0]
      const old = localStreamRef.current?.getAudioTracks()[0]
      if (old) { localStreamRef.current.removeTrack(old); old.stop() }
      localStreamRef.current.addTrack(newTrack)
      newTrack.enabled = audioOn
      if (noiseSupp) {
        const processed = noiseSuppHook.enable(localStreamRef.current)
        processedStreamRef.current = processed
      }
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
      if (bgMode !== 'none') {
        const processed = bgEffect.applyEffect(localStreamRef.current, bgMode)
        processedStreamRef.current = processed
        if (selfVideoRef.current) selfVideoRef.current.srcObject = processed
        const pt = processed.getVideoTracks()[0]
        if (pt) await replaceTrackForAll(pt, 'video')
      } else {
        await replaceTrackForAll(newTrack, 'video')
        if (selfVideoRef.current) selfVideoRef.current.srcObject = localStreamRef.current
      }
      setVideoDeviceId(deviceId)
    } catch (e) { console.error('Failed to switch video device', e) }
  }

  const cycleBgMode = async () => {
    const modes = ['none', 'blur-light', 'blur-heavy']
    const idx = modes.indexOf(bgMode)
    const next = modes[(idx + 1) % modes.length]
    setBgMode(next)
    if (next === 'none') {
      bgEffect.stopEffect()
      processedStreamRef.current = localStreamRef.current
      if (selfVideoRef.current) selfVideoRef.current.srcObject = localStreamRef.current
      const t = localStreamRef.current?.getVideoTracks()[0]
      if (t) await replaceTrackForAll(t, 'video')
    } else {
      const processed = bgEffect.applyEffect(localStreamRef.current, next)
      processedStreamRef.current = processed
      if (selfVideoRef.current) selfVideoRef.current.srcObject = processed
      const t = processed.getVideoTracks()[0]
      if (t) await replaceTrackForAll(t, 'video')
    }
  }

  const toggleNoiseSuppression = async () => {
    if (noiseSupp) {
      noiseSuppHook.disable()
      processedStreamRef.current = localStreamRef.current
      const t = localStreamRef.current?.getAudioTracks()[0]
      if (t) await replaceTrackForAll(t, 'audio')
      setNoiseSupp(false)
    } else {
      const processed = noiseSuppHook.enable(localStreamRef.current)
      processedStreamRef.current = processed
      const t = processed.getAudioTracks()[0]
      if (t) await replaceTrackForAll(t, 'audio')
      setNoiseSupp(true)
    }
  }

  // ── Screen sharing (multi-mode, multi-presenter) ──────────────────────

  const startScreenShare = async (mode) => {
    setShowSharePicker(false)
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
      screenStreamRef.current = stream
      const screenTrack = stream.getVideoTracks()[0]
      await replaceTrackForAll(screenTrack, 'video')
      if (selfVideoRef.current) selfVideoRef.current.srcObject = stream

      const screenAudioTrack = stream.getAudioTracks()[0]
      if (screenAudioTrack) {
        for (const pc of Object.values(pcsRef.current)) pc.addTrack(screenAudioTrack, stream)
      }

      screenTrack.onended = stopScreenShare
      setScreenOn(true)
      setShareMode(mode)
      broadcastMediaState({ audio: audioOn, video: videoOn, screen: true })
      sendSignal({ type: 'screen-share-started', share_mode: mode })
    } catch {
      // user cancelled
    }
  }

  const stopScreenShare = async () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop())
      screenStreamRef.current = null
    }
    const activeStream = getActiveStream()
    const camTrack = activeStream?.getVideoTracks()[0]
    if (camTrack) await replaceTrackForAll(camTrack, 'video')
    if (selfVideoRef.current) selfVideoRef.current.srcObject = activeStream
    setScreenOn(false)
    setShareMode(null)
    setShowAnnotations(false)
    broadcastMediaState({ audio: audioOn, video: videoOn, screen: false })
    sendSignal({ type: 'screen-share-stopped' })
  }

  // ── Whiteboard handlers ────────────────────────────────────────────────

  const handleWbDraw = useCallback((stroke) => {
    if (stroke.tool === 'clear') {
      sendSignal({ type: 'wb-clear' })
    } else {
      sendSignal({ type: 'wb-stroke', stroke })
    }
  }, [sendSignal])

  // ── Annotation handlers ────────────────────────────────────────────────

  const handleAnnotate = useCallback((annotation) => {
    sendSignal({ type: 'annotation', annotation })
  }, [sendSignal])

  const handleAnnotationClear = useCallback(() => {
    sendSignal({ type: 'annotation-clear' })
  }, [sendSignal])

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

  const toggleLayout = () => setLayout((l) => (l === 'grid' ? 'speaker' : 'grid'))

  // ── Other actions ──────────────────────────────────────────────────────

  const leave = () => { try { wsRef.current?.close() } catch {}; navigate('/') }

  const sendReaction = (emoji) => {
    sendSignal({ type: 'reaction', emoji })
    const id = Math.random().toString(36).slice(2)
    setReactions((prev) => [...prev, { id, emoji, left: 10 + Math.random() * 80 }])
    setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), 2400)
    setShowEmoji(false)
  }

  const toggleHand = () => {
    const next = !handRaised
    setHandRaised(next)
    sendSignal({ type: 'raise-hand', raised: next })
  }

  const sendChat = () => {
    const body = chatDraft.trim()
    if (!body) return
    sendSignal({ type: 'chat', body })
    setChatDraft('')
  }

  const copyInvite = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/meet/${code}`) } catch {}
  }

  const togglePin = (peerId) => {
    setPinnedPeerId((current) => {
      const next = current === peerId ? null : peerId
      // Pinning forces speaker layout for clarity; unpin leaves layout alone.
      if (next) setLayout('speaker')
      return next
    })
  }

  const setPermission = (key, value) => {
    sendSignal({ type: 'set-permissions', [key]: value })
  }

  // ── AI meeting recap ───────────────────────────────────────────────────
  const generateRecap = async () => {
    if (recapLoading) return
    setRecapLoading(true)
    setRecapOpen(true)
    setRecapText('')
    try {
      const token = localStorage.getItem('zoiko_token')
      const chatLog = chatMessages.map((m) => ({
        name: m.name,
        body: m.body,
        time: m.created_at,
      }))
      const res = await fetch(`${getApiBase()}/api/ai/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          chat_log: chatLog,
          meeting_title: meetingInfo?.title || `Meeting ${code}`,
        }),
      })
      const data = await res.json()
      setRecapText(data.summary || data.detail || 'No summary returned.')
    } catch (e) {
      setRecapText(`Failed to generate recap: ${e.message || e}`)
    } finally {
      setRecapLoading(false)
    }
  }

  // Kicks off a structured intelligence run on the new endpoint and opens
  // the rich /meet/:code/intelligence page once it's ready. Host-only on the
  // server; we surface the rejection inline if the API says no.
  const generateIntelligence = async () => {
    if (intelLoading) return
    setIntelLoading(true)
    try {
      const token = localStorage.getItem('zoiko_token')
      const chatLog = chatMessages.map((m) => ({
        name: m.name,
        body: m.body,
        time: m.created_at,
      }))
      const participants = [user.name, ...peerList.map((p) => p.name)].filter(Boolean).map((n) => ({ name: n }))
      const res = await fetch(`${getApiBase()}/api/meetings/${code}/intelligence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ chat_log: chatLog, participants, force: true }),
      })
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try { detail = (await res.json()).detail || detail } catch {}
        setPermissionToast(`Intelligence failed: ${detail}`)
        setTimeout(() => setPermissionToast(''), 4000)
        return
      }
      // Open the rich view in a new tab so the meeting keeps running.
      window.open(`/meet/${code}/intelligence`, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setPermissionToast(`Intelligence failed: ${e.message || e}`)
      setTimeout(() => setPermissionToast(''), 4000)
    } finally {
      setIntelLoading(false)
    }
  }

  // ── Live captions (browser SpeechRecognition) ──────────────────────────
  const captionsSupported = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

  const stopCaptions = useCallback(() => {
    const rec = recognitionRef.current
    if (rec) {
      try { rec.onend = null; rec.stop() } catch {}
      recognitionRef.current = null
    }
    setCaptionsOn(false)
    setMyCaption('')
  }, [])

  const startCaptions = useCallback(() => {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Ctor) {
      setPermissionToast('Live captions are not supported in this browser.')
      setTimeout(() => setPermissionToast(''), 3500)
      return
    }
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = navigator.language || 'en-US'
    rec.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0]?.transcript || ''
        if (result.isFinal) {
          sendSignal({ type: 'caption', text: transcript.trim(), is_final: true })
        } else {
          interim += transcript
        }
      }
      setMyCaption(interim)
    }
    rec.onerror = () => { /* swallow; user can re-enable */ }
    rec.onend = () => {
      // Browser auto-stops after silence; restart while toggle is on.
      if (recognitionRef.current === rec) {
        try { rec.start() } catch { stopCaptions() }
      }
    }
    try {
      rec.start()
      recognitionRef.current = rec
      setCaptionsOn(true)
    } catch {
      stopCaptions()
    }
  }, [sendSignal, stopCaptions])

  const toggleCaptions = () => { captionsOn ? stopCaptions() : startCaptions() }

  // Expire stale peer captions after 6s so they don't pile up.
  useEffect(() => {
    if (captionExpiryRef.current) clearInterval(captionExpiryRef.current)
    captionExpiryRef.current = setInterval(() => {
      const cutoff = Date.now() - 6000
      setPeerCaptions((prev) => {
        let changed = false
        const next = { ...prev }
        for (const [k, v] of Object.entries(next)) {
          if (v.ts < cutoff) { delete next[k]; changed = true }
        }
        return changed ? next : prev
      })
    }, 1500)
    return () => { if (captionExpiryRef.current) clearInterval(captionExpiryRef.current) }
  }, [])

  // Stop recognition on unmount.
  useEffect(() => {
    return () => stopCaptions()
  }, [stopCaptions])

  const downloadAttendance = async () => {
    try {
      const token = localStorage.getItem('zoiko_token')
      const res = await fetch(`${getApiBase()}/api/meetings/${code}/attendance`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch attendance')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `attendance-${code}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setPermissionToast(e.message || 'Could not download attendance')
      setTimeout(() => setPermissionToast(''), 3500)
    }
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

  const peerList = useMemo(() => Object.values(peers), [peers])
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

  const qualityLabel = qualityLevel === 'high' ? 'HD' : qualityLevel === 'medium' ? 'SD' : 'LD'
  const activeSharerCount = Object.keys(screenSharers).length + (screenOn ? 1 : 0)
  const anyoneSharing = screenOn || Object.keys(screenSharers).length > 0

  if (err) {
    return (
      <div className="room" style={{ display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <h2>{err}</h2>
          <button className="primary" onClick={() => navigate('/')}>Back home</button>
        </div>
      </div>
    )
  }

  // ── Speaker layout ─────────────────────────────────────────────────────

  const renderSpeakerView = () => {
    // Pin overrides active-speaker. Self-pin forces self into the main slot.
    const isSelfSpeaker = pinnedPeerId === 'self'
      || (!pinnedPeerId && (!speakerPeer || activeSpeaker === 'self'))
    const thumbnailPeers = isSelfSpeaker ? peerList : peerList.filter((p) => p.peer_id !== speakerPeer?.peer_id)
    return (
      <div className="room-stage speaker-layout">
        <div className="speaker-main">
          {isSelfSpeaker ? (
            <div className={'tile self spotlight' + (screenOn ? ' screen' : '') + (speakingPeers.has('self') ? ' speaking' : '') + (pinnedPeerId === 'self' ? ' pinned' : '')}>
              {videoOn || screenOn ? <video ref={attachSelfVideoEl} autoPlay playsInline muted />
                : <div className="tile-placeholder"><Avatar name={user.name} color={user.avatar_color} size="lg" /></div>}
              <button
                className={'tile-pin-btn' + (pinnedPeerId === 'self' ? ' active' : '')}
                onClick={() => togglePin('self')}
                title={pinnedPeerId === 'self' ? 'Unpin' : 'Pin to main view'}
              >
                <Icon name="pin" size={14} />
              </button>
              <div className="tile-name"><span>{user.name} (you){screenOn ? ' · sharing' : ''}</span></div>
              {!audioOn && <div className="tile-muted" title="Muted"><Icon name="micOff" size={14} /></div>}
              {/* Annotation overlay on own screen share */}
              {screenOn && showAnnotations && (
                <AnnotationOverlay
                  onAnnotate={handleAnnotate}
                  remoteAnnotations={remoteAnnotations}
                  onClear={handleAnnotationClear}
                  onClose={() => setShowAnnotations(false)}
                />
              )}
            </div>
          ) : (
            <div className="tile-annotation-wrap">
              <PeerTile
                peer={speakerPeer}
                spotlight
                speaking={speakingPeers.has(speakerPeer.peer_id)}
                pinned={pinnedPeerId === speakerPeer.peer_id}
                onTogglePin={() => togglePin(speakerPeer.peer_id)}
              />
              {speakerPeer.screen && showAnnotations && (
                <AnnotationOverlay
                  onAnnotate={handleAnnotate}
                  remoteAnnotations={remoteAnnotations}
                  onClear={handleAnnotationClear}
                  onClose={() => setShowAnnotations(false)}
                />
              )}
            </div>
          )}
        </div>
        <div className="speaker-strip">
          {!isSelfSpeaker && (
            <div className={'tile self mini' + (speakingPeers.has('self') ? ' speaking' : '')}>
              {videoOn ? <video ref={!isSelfSpeaker ? attachSelfVideoEl : undefined} autoPlay playsInline muted />
                : <div className="tile-placeholder"><Avatar name={user.name} color={user.avatar_color} size="sm" /></div>}
              <div className="tile-name"><span>{user.name}</span></div>
              {!audioOn && <div className="tile-muted" title="Muted"><Icon name="micOff" size={12} /></div>}
            </div>
          )}
          {thumbnailPeers.map((p) => (
            <PeerTile
              key={p.peer_id}
              peer={p}
              mini
              speaking={speakingPeers.has(p.peer_id)}
              pinned={pinnedPeerId === p.peer_id}
              onTogglePin={() => togglePin(p.peer_id)}
            />
          ))}
        </div>
      </div>
    )
  }

  // ── Grid layout ────────────────────────────────────────────────────────

  const renderGridView = () => (
    <div className={`room-stage tiles-${Math.min(tileCount, 12)}`}>
      <div className={'tile self' + (screenOn ? ' screen' : '') + (speakingPeers.has('self') ? ' speaking' : '') + (pinnedPeerId === 'self' ? ' pinned' : '')}>
        {videoOn || screenOn ? <video ref={attachSelfVideoEl} autoPlay playsInline muted />
          : <div className="tile-placeholder"><Avatar name={user.name} color={user.avatar_color} size="lg" /></div>}
        {handRaised && <div className="tile-hand" title="Hand raised"><Icon name="hand" size={16} /></div>}
        <button
          className={'tile-pin-btn' + (pinnedPeerId === 'self' ? ' active' : '')}
          onClick={() => togglePin('self')}
          title={pinnedPeerId === 'self' ? 'Unpin' : 'Pin to main view'}
        >
          <Icon name="pin" size={14} />
        </button>
        <div className="tile-name">
          <span>{user.name} (you){screenOn ? ' · sharing' : ''}</span>
          {isHost && <span className="tile-role-badge host">Host</span>}
          {!isHost && myRole === 'co_host' && <span className="tile-role-badge cohost">Co-host</span>}
        </div>
        {!audioOn && <div className="tile-muted" title="Muted"><Icon name="micOff" size={14} /></div>}
        {screenOn && showAnnotations && (
          <AnnotationOverlay
            onAnnotate={handleAnnotate}
            remoteAnnotations={remoteAnnotations}
            onClear={handleAnnotationClear}
            onClose={() => setShowAnnotations(false)}
          />
        )}
      </div>
      {peerList.map((p) => (
        <div key={p.peer_id} className="tile-annotation-wrap">
          <PeerTile
            peer={p}
            speaking={speakingPeers.has(p.peer_id)}
            pinned={pinnedPeerId === p.peer_id}
            onTogglePin={() => togglePin(p.peer_id)}
          />
          {p.screen && showAnnotations && (
            <AnnotationOverlay
              onAnnotate={handleAnnotate}
              remoteAnnotations={remoteAnnotations}
              onClear={handleAnnotationClear}
              onClose={() => setShowAnnotations(false)}
            />
          )}
        </div>
      ))}
    </div>
  )

  return (
    <div className="room room-themed">
      {/* Ambient mesh background — futuristic depth */}
      <div aria-hidden className="room-ambient">
        <div className="room-ambient-grid" />
        <div className="room-ambient-orb room-ambient-orb-a" />
        <div className="room-ambient-orb room-ambient-orb-b" />
        <div className="room-ambient-orb room-ambient-orb-c" />
      </div>

      <div className="room-topbar room-topbar-glass">
        <Logo size={36} withWordmark />
        <span className="room-topbar-pill">Meeting</span>
        <div className="room-title" />
        <div className="room-meta">
          {isRecording && (
            <Badge tone="danger" size="md" pulse>
              <RecIcon className="h-3 w-3" /> REC {formatRecTime(recordingTime)}
            </Badge>
          )}
          <Badge tone="live" size="md" pulse>Live</Badge>
          <Badge tone="neutral" size="md" title={`Quality: ${qualityLevel}`}>{qualityLabel}</Badge>
          {meetingLocked && (
            <Badge tone="warn" size="md" title="Meeting is locked"><LockIcon className="h-3 w-3" /> Locked</Badge>
          )}
          {activeSharerCount > 0 && (
            <Badge tone="accent" size="md" title={`${activeSharerCount} presenting`}>
              <ShareIcon className="h-3 w-3" /> {activeSharerCount} sharing
            </Badge>
          )}
          <span className="room-code-pill mono" title="Meeting code">{code}</span>
          <button
            className="room-copy-pill"
            onClick={copyInvite}
            title="Copy invite link"
            aria-label="Copy invite link"
          >
            <CopyIcon className="h-3.5 w-3.5" /> Copy
          </button>
          <ThemeToggle />
        </div>
      </div>

      <div className="room-main">
        {/* Whiteboard overlay */}
        {showWhiteboard && (
          <Whiteboard
            onDraw={handleWbDraw}
            remoteStrokes={remoteWbStrokes}
            onClose={() => setShowWhiteboard(false)}
          />
        )}

        {!showWhiteboard && (layout === 'speaker' && peerList.length > 0 ? renderSpeakerView() : renderGridView())}

        {sidebar && (
          <div className="room-sidebar">
            <div className="room-sidebar-tabs">
              <button className={'room-sidebar-tab' + (sidebar === 'chat' ? ' active' : '')} onClick={() => setSidebar('chat')}>
                <Icon name="chat" size={14} /> Chat
              </button>
              <button className={'room-sidebar-tab' + (sidebar === 'people' ? ' active' : '')} onClick={() => setSidebar('people')}>
                <Icon name="users" size={14} /> People · {tileCount}
                {waitingList.length > 0 && <span className="waiting-count">{waitingList.length}</span>}
              </button>
              <button className={'room-sidebar-tab' + (sidebar === 'ai' ? ' active' : '')} onClick={() => setSidebar('ai')}>
                <Icon name="robot" size={14} /> AI
              </button>
              <button className={'room-sidebar-tab' + (sidebar === 'settings' ? ' active' : '')} onClick={() => setSidebar('settings')}>
                <Icon name="settings" size={14} /> Settings
              </button>
              <button className="room-sidebar-tab" onClick={() => setSidebar(null)} title="Close" style={{ flex: '0 0 auto', width: 36 }}>
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className="room-sidebar-body">
              {sidebar === 'chat' && (
                <div className="room-chat-messages">
                  {chatMessages.length === 0 && (
                    <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                      No messages yet. Say hi!
                    </div>
                  )}
                  {chatMessages.map((m, i) => (
                    <div key={i} className="room-chat-msg">
                      <div>
                        <span className="room-chat-msg-name" style={{ color: m.color }}>{m.name}</span>
                        <span className="room-chat-msg-time">
                          {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="room-chat-msg-body">{m.body}</div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              )}

              {sidebar === 'people' && (
                <div className="room-participants">
                  {isHostOrCohost && waitingList.length > 0 && (
                    <div className="waiting-room-section">
                      <div className="waiting-room-header">
                        <span className="waiting-room-label"><Icon name="clock" size={13} /> Waiting room ({waitingList.length})</span>
                        <button className="ghost waiting-admit-all" onClick={admitAll}>Admit all</button>
                      </div>
                      {waitingList.map((w) => (
                        <div className="room-participant waiting-participant" key={w.user_id}>
                          <Avatar name={w.name} color={w.color} size="sm" />
                          <div className="room-participant-name">{w.name}</div>
                          <div className="participant-actions">
                            <button className="participant-action admit" onClick={() => admitUser(w.user_id)} title="Admit"><Icon name="check" size={14} /></button>
                            <button className="participant-action deny" onClick={() => denyUser(w.user_id)} title="Deny"><Icon name="close" size={14} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="room-participant">
                    <Avatar name={user.name} color={user.avatar_color} size="sm" />
                    <div className="room-participant-name">
                      {user.name} (you)
                      {isHost && <span className="role-tag host">Host</span>}
                      {!isHost && myRole === 'co_host' && <span className="role-tag cohost">Co-host</span>}
                    </div>
                    <div className="room-participant-badge">
                      {screenOn && <span className="room-participant-badge screen-tag" title="Sharing screen"><Icon name="screen" size={14} /></span>}
                      {!audioOn && <span className="room-participant-badge muted" title="Muted"><Icon name="micOff" size={14} /></span>}
                      {!videoOn && <span className="room-participant-badge muted" title="Camera off"><Icon name="cameraOff" size={14} /></span>}
                      {handRaised && <span className="room-participant-badge hand" title="Hand raised"><Icon name="hand" size={14} /></span>}
                    </div>
                  </div>
                  {peerList.map((p) => (
                    <div className="room-participant" key={p.peer_id}>
                      <Avatar name={p.name} color={p.color} size="sm" />
                      <div className="room-participant-name">
                        {p.name}
                        {p.role === 'host' && <span className="role-tag host">Host</span>}
                        {p.role === 'co_host' && <span className="role-tag cohost">Co-host</span>}
                      </div>
                      <div className="room-participant-badge">
                        {p.screen && <span className="room-participant-badge screen-tag" title="Sharing screen"><Icon name="screen" size={14} /></span>}
                        {p.audio === false && <span className="room-participant-badge muted" title="Muted"><Icon name="micOff" size={14} /></span>}
                        {p.video === false && <span className="room-participant-badge muted" title="Camera off"><Icon name="cameraOff" size={14} /></span>}
                        {p.hand && <span className="room-participant-badge hand" title="Hand raised"><Icon name="hand" size={14} /></span>}
                      </div>
                      {isHostOrCohost && p.user_id && (
                        <div className="participant-actions">
                          {isHost && (
                            <button className="participant-action" onClick={() => promoteUser(p.user_id)} title={p.role === 'co_host' ? 'Remove co-host' : 'Make co-host'}>
                              <Icon name="shield" size={13} />
                            </button>
                          )}
                          <button className="participant-action deny" onClick={() => kickUser(p.user_id)} title="Remove from meeting">
                            <Icon name="hangup" size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {isHostOrCohost && (
                    <div className="host-controls-section">
                      <div className="host-controls-divider" />
                      <button className={'host-control-btn' + (meetingLocked ? ' active' : '')} onClick={toggleLock}>
                        <Icon name="lock" size={14} /> {meetingLocked ? 'Unlock meeting' : 'Lock meeting'}
                      </button>
                      <button
                        className={'host-control-btn' + (!chatEnabled ? ' active' : '')}
                        onClick={() => setPermission('chat_enabled', !chatEnabled)}
                        title={chatEnabled ? 'Prevent participants from sending chat' : 'Allow participants to chat'}
                      >
                        <Icon name="chat" size={14} /> {chatEnabled ? 'Disable participant chat' : 'Enable participant chat'}
                      </button>
                      <button
                        className={'host-control-btn' + (!screenshareEnabled ? ' active' : '')}
                        onClick={() => setPermission('screenshare_enabled', !screenshareEnabled)}
                        title={screenshareEnabled ? 'Prevent participants from sharing their screen' : 'Allow participants to share their screen'}
                      >
                        <Icon name="screen" size={14} /> {screenshareEnabled ? 'Disable participant screen share' : 'Enable participant screen share'}
                      </button>
                      {isHost && (
                        <button className="host-control-btn" onClick={downloadAttendance} title="Download attendance as CSV">
                          <Icon name="download" size={14} /> Download attendance (CSV)
                        </button>
                      )}
                      <button className="host-control-btn" onClick={generateRecap} disabled={recapLoading || chatMessages.length === 0} title="Quick plain-text recap from chat">
                        <Icon name="sparkle" size={14} /> {recapLoading ? 'Generating recap…' : 'Generate AI recap'}
                      </button>
                      <button
                        className="host-control-btn"
                        onClick={generateIntelligence}
                        disabled={intelLoading || chatMessages.length === 0}
                        title="Open the structured Meeting Intelligence page in a new tab"
                      >
                        <Icon name="sparkle" size={14} /> {intelLoading ? 'Analyzing…' : 'Open Meeting Intelligence'}
                      </button>
                      {isHost && (
                        <button className="host-control-btn danger" onClick={endMeeting}>
                          <Icon name="hangup" size={14} /> End meeting for all
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {sidebar === 'ai' && (
                <AIChatPanel
                  embedded
                  meetingContext={{
                    meeting_code: code,
                    title: meetingInfo?.title,
                    participants: [user.name, ...peerList.map(p => p.name)].filter(Boolean),
                    chat_log: chatMessages.map(m => ({ name: m.name, body: m.body, time: m.created_at })),
                  }}
                />
              )}

              {sidebar === 'settings' && (
                <div className="room-settings">
                  <div className="settings-section">
                    <div className="settings-section-title">Camera</div>
                    <select className="settings-select" value={videoDeviceId} onChange={(e) => switchVideoDevice(e.target.value)}>
                      {devices.video.length === 0 && <option value="">No cameras found</option>}
                      {devices.video.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 8)}`}</option>
                      ))}
                    </select>
                  </div>
                  <div className="settings-section">
                    <div className="settings-section-title">Microphone</div>
                    <select className="settings-select" value={audioDeviceId} onChange={(e) => switchAudioDevice(e.target.value)}>
                      {devices.audio.length === 0 && <option value="">No microphones found</option>}
                      {devices.audio.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0, 8)}`}</option>
                      ))}
                    </select>
                  </div>
                  <div className="settings-section">
                    <div className="settings-section-title">Background</div>
                    <div className="settings-bg-options">
                      {[
                        { mode: 'none', label: 'None', icon: 'close' },
                        { mode: 'blur-light', label: 'Light blur', icon: 'blur' },
                        { mode: 'blur-heavy', label: 'Heavy blur', icon: 'blur' },
                      ].map((opt) => (
                        <button key={opt.mode} className={'settings-bg-btn' + (bgMode === opt.mode ? ' active' : '')} onClick={() => {
                          setBgMode(opt.mode)
                          if (opt.mode === 'none') {
                            bgEffect.stopEffect()
                            processedStreamRef.current = localStreamRef.current
                            if (selfVideoRef.current) selfVideoRef.current.srcObject = localStreamRef.current
                            const t = localStreamRef.current?.getVideoTracks()[0]
                            if (t) replaceTrackForAll(t, 'video')
                          } else {
                            const processed = bgEffect.applyEffect(localStreamRef.current, opt.mode)
                            processedStreamRef.current = processed
                            if (selfVideoRef.current) selfVideoRef.current.srcObject = processed
                            const t = processed.getVideoTracks()[0]
                            if (t) replaceTrackForAll(t, 'video')
                          }
                        }}>
                          <Icon name={opt.icon} size={16} /><span>{opt.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-section">
                    <div className="settings-section-title">Audio processing</div>
                    <button className={'settings-toggle-btn' + (noiseSupp ? ' active' : '')} onClick={toggleNoiseSuppression}>
                      <Icon name="noise" size={16} /><span>Noise suppression</span>
                      <span className="settings-toggle-state">{noiseSupp ? 'On' : 'Off'}</span>
                    </button>
                  </div>
                  <div className="settings-section">
                    <div className="settings-section-title">Stream quality</div>
                    <div className="settings-quality-indicator">
                      <div className={'quality-dot quality-' + qualityLevel} />
                      <span>{qualityLevel === 'high' ? '720p HD' : qualityLevel === 'medium' ? '480p SD' : '240p'}</span>
                      <span className="settings-quality-auto">(auto-adjusts)</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {sidebar === 'chat' && (() => {
              const chatBlocked = !chatEnabled && !isHostOrCohost
              return (
                <div className="room-chat-composer">
                  <input
                    placeholder={chatBlocked ? 'Chat is disabled by the host' : 'Send a message to everyone'}
                    value={chatDraft}
                    onChange={(e) => setChatDraft(e.target.value)}
                    disabled={chatBlocked}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendChat() } }}
                  />
                  <button className="primary chat-send" onClick={sendChat} disabled={chatBlocked || !chatDraft.trim()} aria-label="Send">
                    <Icon name="send" size={16} />
                  </button>
                </div>
              )
            })()}
          </div>
        )}
      </div>

      {/* ── Bottom controls (new glass dock) ──────────────────────────── */}
      <MeetingDock
        clock={clock}
        code={code}
        audioOn={audioOn}
        toggleAudio={toggleAudio}
        videoOn={videoOn}
        toggleVideo={toggleVideo}
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
        bgMode={bgMode}
        cycleBgMode={cycleBgMode}
        noiseSupp={noiseSupp}
        toggleNoiseSuppression={toggleNoiseSuppression}
        handRaised={handRaised}
        toggleHand={toggleHand}
        captionsSupported={captionsSupported}
        captionsOn={captionsOn}
        toggleCaptions={toggleCaptions}
        showEmoji={showEmoji}
        setShowEmoji={setShowEmoji}
        sendReaction={sendReaction}
        showWhiteboard={showWhiteboard}
        setShowWhiteboard={setShowWhiteboard}
        anyoneSharing={anyoneSharing}
        showAnnotations={showAnnotations}
        setShowAnnotations={setShowAnnotations}
        layout={layout}
        toggleLayout={toggleLayout}
        sidebar={sidebar}
        setSidebar={setSidebar}
        waitingList={waitingList}
        leave={leave}
      />

      <div className="reaction-overlay">
        {reactions.map((r) => (
          <div key={r.id} className="reaction-bubble" style={{ left: `${r.left}%` }}>{r.emoji}</div>
        ))}
      </div>

      {permissionToast && (
        <div className="permission-toast" role="alert">{permissionToast}</div>
      )}

      {(captionsOn || Object.keys(peerCaptions).length > 0) && (
        <div className="caption-strip" aria-live="polite">
          {Object.entries(peerCaptions).map(([pid, c]) => (
            <div key={pid} className="caption-line">
              <span className="caption-name" style={{ color: c.color }}>{c.name}:</span>
              <span className="caption-text">{c.text}</span>
            </div>
          ))}
          {captionsOn && myCaption && (
            <div className="caption-line caption-mine">
              <span className="caption-name">You:</span>
              <span className="caption-text caption-interim">{myCaption}</span>
            </div>
          )}
        </div>
      )}

      {recapOpen && (
        <div className="recap-modal-backdrop" onClick={() => !recapLoading && setRecapOpen(false)}>
          <div className="recap-modal" onClick={(e) => e.stopPropagation()}>
            <div className="recap-modal-header">
              <Icon name="sparkle" size={16} />
              <span>AI meeting recap</span>
              <button className="ghost recap-modal-close" onClick={() => setRecapOpen(false)} disabled={recapLoading} aria-label="Close">
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className="recap-modal-body">
              {recapLoading ? <div className="spinner" /> : (
                <pre className="recap-modal-text">{recapText}</pre>
              )}
            </div>
            {!recapLoading && recapText && (
              <div className="recap-modal-footer">
                <button className="ghost" onClick={() => navigator.clipboard?.writeText(recapText)}>
                  <Icon name="copy" size={14} /> Copy
                </button>
                <button className="primary" onClick={() => setRecapOpen(false)}>Done</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// PeerTile is now imported from ../components/meeting/PeerTile
