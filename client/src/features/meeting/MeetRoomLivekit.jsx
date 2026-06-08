import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
} from '@livekit/components-react'
import { ConnectionState, DisconnectReason, VideoPresets } from 'livekit-client'
import { PencilLine, Users } from 'lucide-react'
import '@livekit/components-styles'

import { fetchMediaToken } from './api/media.js'
import { getRecordingState, startRecording, stopRecording } from './api/recording.js'
import { api } from '../../api/client.js'
import { useAuth } from '../../context/AuthContext.jsx'

import Stage from './components/Stage.jsx'
import MeetingDock from '../../components/meeting/MeetingDock.jsx'
import ChatPanel from './components/ChatPanel.jsx'
import WaitingRoomPanel from './components/WaitingRoomPanel.jsx'
import HostMenu from './components/HostMenu.jsx'
import DevicePicker from './components/DevicePicker.jsx'
import ReactionOverlay from './components/ReactionOverlay.jsx'
import ParticipantsPanel from './components/ParticipantsPanel.jsx'
import CaptionsOverlay from './components/CaptionsOverlay.jsx'
import Whiteboard from '../../components/Whiteboard.jsx'   // reused from legacy
import useMeetingControlWs from './hooks/useMeetingControlWs.js'
import useRoomEvents, { RoomEvent } from './hooks/useRoomEvents.js'
import useMutedWhileSpeaking from './hooks/useMutedWhileSpeaking.js'
import { useLocalParticipant, useMediaDeviceSelect, useRoomContext } from '@livekit/components-react'
import { useCaptions } from './components/CaptionsOverlay.jsx'
import { useRoomStore } from './state/roomStore.js'

const ROOM_OPTIONS = {
  adaptiveStream: true,
  dynacast: true,
  publishDefaults: {
    simulcast: true,
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360, VideoPresets.h720],
    dtx: true,
    red: true,
  },
  videoCaptureDefaults: {
    resolution: VideoPresets.h720.resolution,
  },
}

export default function MeetRoomLivekit() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  // Connection bootstrap
  const [token, setToken] = useState(null)
  const [wsUrl, setWsUrl] = useState(null)
  const [error, setError] = useState(null)
  const [phase, setPhase] = useState('joining') // joining | connecting | live | error | left

  // App state from the control WS
  const [isHost, setIsHost] = useState(false)
  const [myRole, setMyRole] = useState('participant')
  const [meeting, setMeeting] = useState({
    locked: false,
    chat_enabled: true,
    screenshare_enabled: true,
  })
  const [waiting, setWaiting] = useState([])
  const [handRaised, setHandRaised] = useState(false)
  const [recording, setRecording] = useState({ recording: false, recording_id: null })

  // Local UI state
  const [sidebar, setSidebar] = useState(null) // 'chat' | 'waiting' | 'people' | null
  const [chatMessages, setChatMessages] = useState([])
  const [unreadChat, setUnreadChat] = useState(0)
  const [unreadWaiting, setUnreadWaiting] = useState(0)
  const [showEmoji, setShowEmoji] = useState(false)
  const [showDevices, setShowDevices] = useState(false)
  const [showWhiteboard, setShowWhiteboard] = useState(false)
  const [wbStrokes, setWbStrokes] = useState([])  // remote strokes from WS
  const { byPeer: liveCaptions, push: pushCaption } = useCaptions()
  const [toasts, setToasts] = useState([]) // [{ id, kind, text }]
  const toastIdRef = useRef(0)
  const pushToast = useCallback((t) => {
    if (!t || !t.text) return
    const id = ++toastIdRef.current
    setToasts((prev) => [...prev.slice(-3), { id, ...t }])
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 3500)
  }, [])
  // legacy single-toast API used by recording/permission-denied paths
  const setToast = pushToast
  const msgKeyRef = useRef(0)

  const reactions = useRoomStore((s) => s.reactions)
  const pushReaction = useRoomStore((s) => s.pushReaction)
  const setHand = useRoomStore((s) => s.setHand)
  const setRole = useRoomStore((s) => s.setRole)
  const seedRoles = useRoomStore((s) => s.seedRoles)

  // ── Control WS ──────────────────────────────────────────────────────────
  const { connected: ctrlConnected, send: ctrlSend, subscribe: ctrlSubscribe } =
    useMeetingControlWs(code)

  useEffect(() => {
    return ctrlSubscribe((data) => {
      const t = data.type
      if (t === 'welcome') {
        setIsHost(!!data.is_host)
        setMyRole(data.role || 'participant')
        setMeeting({
          locked: !!data.meeting?.locked,
          chat_enabled: !!data.meeting?.chat_enabled,
          screenshare_enabled: !!data.meeting?.screenshare_enabled,
        })
        // Seed the role map: self + every peer already in the room.
        const entries = []
        if (data.self?.user_id) entries.push([data.self.user_id, data.role || 'participant'])
        for (const p of data.peers || []) {
          if (p.user_id) entries.push([p.user_id, p.role || 'participant'])
        }
        seedRoles(entries)
      } else if (t === 'peer-joined') {
        const p = data.peer
        if (p?.user_id) setRole(p.user_id, p.role || 'participant')
      } else if (t === 'role-changed') {
        if (typeof data.user_id === 'number') setRole(data.user_id, data.role)
      } else if (t === 'chat') {
        const msg = { ...data, _key: ++msgKeyRef.current }
        setChatMessages((prev) => [...prev, msg])
        if (sidebar !== 'chat') setUnreadChat((n) => n + 1)
      } else if (t === 'reaction') {
        pushReaction({ peer_id: data.peer_id, user_id: data.user_id, name: data.name, emoji: data.emoji })
      } else if (t === 'raise-hand') {
        if (typeof data.user_id === 'number') setHand(data.user_id, !!data.raised)
      } else if (t === 'waiting-room') {
        const list = Array.isArray(data.waiting) ? data.waiting : []
        setWaiting((prev) => {
          if (list.length > prev.length && sidebar !== 'waiting') {
            setUnreadWaiting((n) => n + (list.length - prev.length))
          }
          return list
        })
      } else if (t === 'meeting-permissions') {
        setMeeting((m) => ({
          ...m,
          chat_enabled: data.chat_enabled ?? m.chat_enabled,
          screenshare_enabled: data.screenshare_enabled ?? m.screenshare_enabled,
        }))
      } else if (t === 'meeting-locked') {
        setMeeting((m) => ({ ...m, locked: !!data.locked }))
      } else if (t === 'meeting-ended') {
        userLeftRef.current = true
        setToast({ kind: 'info', text: 'Meeting ended by host' })
        setTimeout(() => navigate('/meet', { replace: true }), 1500)
      } else if (t === 'role-changed' && data.user_id === user?.id) {
        setMyRole(data.role)
      } else if (t === 'permission-denied') {
        setToast({ kind: 'error', text: data.reason || 'Action not allowed' })
      } else if (t === 'caption') {
        pushCaption(data.peer_id, { name: data.name, color: data.color, text: data.text })
      } else if (t === 'wb-stroke') {
        if (data.stroke) setWbStrokes((prev) => [...prev, data.stroke])
      } else if (t === 'wb-clear') {
        setWbStrokes([])
      }
    })
  }, [ctrlSubscribe, sidebar, navigate, user?.id, pushReaction, setHand])

  useEffect(() => { if (sidebar === 'chat') setUnreadChat(0) }, [sidebar])
  useEffect(() => { if (sidebar === 'waiting') setUnreadWaiting(0) }, [sidebar])

  // ── Media-token mint flow ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await api(`/api/meetings/${code}/join`, { method: 'POST' })
        const t = await fetchMediaToken(code)
        if (cancelled) return
        setToken(t.access_token)
        setWsUrl(t.ws_url)
        setPhase('connecting')
        // Probe recording state (host UI uses this on mount)
        try { setRecording(await getRecordingState(code)) } catch { /* ignore */ }
      } catch (e) {
        if (cancelled) return
        const msg = e?.message || 'Failed to join'
        // Auto-fallback: if /media-token 503s because LiveKit isn't
        // configured in this environment, bounce to the mesh room instead
        // of dead-ending on an error screen. This happens when a user
        // deep-links /room-lk on a deployment that hasn't enabled the SFU
        // yet — common during the strangler-fig migration.
        if (/livekit is not enabled/i.test(msg)) {
          navigate(`/meet/${code}/room`, { replace: true })
          return
        }
        setError(msg)
        setPhase('error')
      }
    })()
    return () => { cancelled = true }
  }, [code, navigate])

  // ── Actions ──────────────────────────────────────────────────────────────
  const sendChat = useCallback((body) => ctrlSend({ type: 'chat', body }), [ctrlSend])
  const sendReaction = useCallback((emoji) => {
    ctrlSend({ type: 'reaction', emoji })
    setShowEmoji(false)
  }, [ctrlSend])
  const toggleHand = useCallback(() => {
    setHandRaised((raised) => {
      const next = !raised
      ctrlSend({ type: 'raise-hand', raised: next })
      return next
    })
  }, [ctrlSend])
  const admitUser = useCallback((uid) => ctrlSend({ type: 'admit', user_id: uid }), [ctrlSend])
  const denyUser = useCallback((uid) => ctrlSend({ type: 'deny', user_id: uid }), [ctrlSend])
  const admitAll = useCallback(() => ctrlSend({ type: 'admit-all' }), [ctrlSend])
  const kickUser = useCallback((uid, name) => {
    if (!confirm(`Remove ${name || 'this participant'} from the meeting?`)) return
    ctrlSend({ type: 'kick', user_id: uid })
  }, [ctrlSend])
  const promoteUser = useCallback((uid) => ctrlSend({ type: 'promote', user_id: uid }), [ctrlSend])
  const setLock = useCallback((locked) => ctrlSend({ type: 'lock', locked }), [ctrlSend])
  const setChatEnabled = useCallback((v) => ctrlSend({ type: 'set-permissions', chat_enabled: v }), [ctrlSend])
  const setScreenEnabled = useCallback((v) => ctrlSend({ type: 'set-permissions', screenshare_enabled: v }), [ctrlSend])
  const endMeeting = useCallback(() => {
    if (!confirm('End the meeting for everyone?')) return
    ctrlSend({ type: 'end-meeting' })
  }, [ctrlSend])

  const toggleRecord = useCallback(async () => {
    try {
      if (recording.recording) {
        await stopRecording(code)
        setToast({ kind: 'info', text: 'Recording will stop in a moment…' })
        setRecording({ recording: false, recording_id: null })
      } else {
        const r = await startRecording(code)
        setRecording(r)
        setToast({ kind: 'info', text: 'Recording started' })
      }
    } catch (e) {
      setToast({ kind: 'error', text: e?.message || 'Recording action failed' })
    }
  }, [code, recording.recording])

  // Track user-initiated leave vs everything else. React Strict Mode (dev)
  // mounts then unmounts then mounts the component, which makes LiveKitRoom
  // disconnect transiently — without this flag, that transient disconnect
  // would navigate the user home and they'd never see the room. Production
  // doesn't double-mount, but the flag costs nothing and also correctly
  // distinguishes "user clicked Leave" from "SFU kicked us".
  const userLeftRef = useRef(false)
  const userLeave = useCallback(() => {
    userLeftRef.current = true
    setPhase('left')
    navigate('/meet', { replace: true })
  }, [navigate])

  const handleDisconnected = useCallback((reason) => {
    // Only navigate when the user actually clicked Leave OR the SFU
    // rejected/kicked us. CLIENT_INITIATED with userLeftRef=false is the
    // Strict Mode double-mount case — stay put and let the remount reconnect.
    if (userLeftRef.current) {
      navigate('/meet', { replace: true })
      return
    }
    const remoteKick =
      reason === DisconnectReason.DUPLICATE_IDENTITY ||
      reason === DisconnectReason.SERVER_SHUTDOWN ||
      reason === DisconnectReason.PARTICIPANT_REMOVED ||
      reason === DisconnectReason.ROOM_DELETED
    if (remoteKick) {
      setError(
        reason === DisconnectReason.PARTICIPANT_REMOVED
          ? 'Removed from meeting'
          : reason === DisconnectReason.ROOM_DELETED
            ? 'Meeting ended'
            : reason === DisconnectReason.DUPLICATE_IDENTITY
              ? 'Joined from another tab'
              : 'Server disconnected'
      )
      setPhase('left')
      setTimeout(() => navigate('/meet', { replace: true }), 1500)
    }
    // Anything else (CLIENT_INITIATED w/o user leave) — silently ignored;
    // LiveKitRoom will reconnect if it can, or stay disconnected.
  }, [navigate])

  const isHostOrCohost = isHost || myRole === 'co_host'

  // ── Render gates ─────────────────────────────────────────────────────────
  if (phase === 'joining' || (phase === 'connecting' && !token)) {
    return <Splash text="Joining meeting…" />
  }
  if (phase === 'error') {
    return (
      <Splash text={error || 'Failed to join'}>
        <button
          onClick={() => navigate('/meet')}
          className="mt-4 px-4 py-2 rounded bg-zinc-700 hover:bg-zinc-600 text-white"
        >
          Back to meetings
        </button>
      </Splash>
    )
  }

  return (
    <LiveKitRoom
      token={token}
      serverUrl={wsUrl}
      options={ROOM_OPTIONS}
      connect
      audio
      video
      onDisconnected={handleDisconnected}
      onError={(e) => setError(e?.message || String(e))}
      className="h-screen w-screen flex flex-col bg-[#f1f3f4] text-[#202124]"
    >
      <Header
        code={code}
        ctrlConnected={ctrlConnected}
        recording={recording.recording}
        isHostOrCohost={isHostOrCohost}
        meeting={meeting}
        onLock={setLock}
        onChatEnabled={setChatEnabled}
        onScreenEnabled={setScreenEnabled}
        onEnd={endMeeting}
      />

      <div className="flex-1 flex min-h-0 relative">
        <div className="flex-1 flex flex-col min-w-0 relative">
          <Stage />
          <ReactionOverlay events={reactions} />
          <CaptionsOverlay captions={liveCaptions} />
          {showWhiteboard && (
            <div className="absolute inset-0 z-20">
              <Whiteboard
                remoteStrokes={wbStrokes}
                onDraw={(stroke) => ctrlSend({ type: 'wb-stroke', stroke })}
                onClose={() => setShowWhiteboard(false)}
              />
            </div>
          )}
        </div>
        {sidebar === 'chat' && (
          <ChatPanel
            messages={chatMessages}
            onSend={sendChat}
            onClose={() => setSidebar(null)}
            disabled={!meeting.chat_enabled && !isHostOrCohost}
          />
        )}
        {sidebar === 'waiting' && isHostOrCohost && (
          <WaitingRoomPanel
            waiting={waiting}
            onAdmit={admitUser}
            onDeny={denyUser}
            onAdmitAll={admitAll}
            onClose={() => setSidebar(null)}
          />
        )}
        {sidebar === 'people' && (
          <ParticipantsPanel
            selfUserId={user?.id}
            isHost={isHost}
            isHostOrCohost={isHostOrCohost}
            onClose={() => setSidebar(null)}
            onKick={kickUser}
            onPromote={promoteUser}
          />
        )}
      </div>

      <RoomAudioRenderer />

      <LivekitDockAdapter
        code={code}
        isHostOrCohost={isHostOrCohost}
        screenshareEnabled={meeting.screenshare_enabled}
        sidebar={sidebar}
        setSidebar={setSidebar}
        waitingList={isHostOrCohost ? waiting : []}
        unreadChat={unreadChat}
        unreadWaiting={unreadWaiting}
        handRaised={handRaised}
        toggleHand={toggleHand}
        showEmoji={showEmoji}
        setShowEmoji={setShowEmoji}
        sendReaction={sendReaction}
        isRecording={recording.recording}
        toggleRecording={toggleRecord}
        showWhiteboard={showWhiteboard}
        toggleWhiteboard={() => setShowWhiteboard((v) => !v)}
        openDevices={() => setShowDevices(true)}
        leave={userLeave}
      />

      {showDevices && <DevicePicker onClose={() => setShowDevices(false)} />}

      <RoomEffects pushToast={pushToast} />
      <ReconnectToast />
      <ToastStack toasts={toasts} />
      {error && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-red-600/90 text-white px-3 py-2 rounded text-sm">
          {error}
        </div>
      )}
    </LiveKitRoom>
  )
}

/* ── Subcomponents ─────────────────────────────────────────────────────── */

/**
 * Bridges the shared <MeetingDock> to LiveKit's local-participant state.
 * Must live inside <LiveKitRoom> because it uses LK hooks.
 *
 * Mic / camera / screen-share state come from `localParticipant`; everything
 * else (chat, hand, reactions, recording, whiteboard) is passed in from the
 * parent because those flow through our own control WebSocket.
 */
function LivekitDockAdapter({
  code,
  isHostOrCohost,
  screenshareEnabled,
  sidebar,
  setSidebar,
  waitingList,
  unreadChat,
  unreadWaiting,
  handRaised,
  toggleHand,
  showEmoji,
  setShowEmoji,
  sendReaction,
  isRecording,
  toggleRecording,
  showWhiteboard,
  toggleWhiteboard,
  openDevices,
  leave,
}) {
  const { localParticipant } = useLocalParticipant()
  const audioInputs = useMediaDeviceSelect({ kind: 'audioinput' })
  const videoInputs = useMediaDeviceSelect({ kind: 'videoinput' })
  const [clock, setClock] = useState(() => fmtClock(new Date()))

  useEffect(() => {
    const t = setInterval(() => setClock(fmtClock(new Date())), 30_000)
    return () => clearInterval(t)
  }, [])

  const micOn = !!localParticipant?.isMicrophoneEnabled
  const camOn = !!localParticipant?.isCameraEnabled
  const screenOn = !!localParticipant?.isScreenShareEnabled

  const toggleMic = useCallback(
    () => localParticipant?.setMicrophoneEnabled(!micOn).catch(() => {}),
    [localParticipant, micOn],
  )
  const toggleCam = useCallback(
    () => localParticipant?.setCameraEnabled(!camOn).catch(() => {}),
    [localParticipant, camOn],
  )
  const startShare = useCallback(
    () => localParticipant?.setScreenShareEnabled(true).catch(() => {}),
    [localParticipant],
  )
  const stopShare = useCallback(
    () => localParticipant?.setScreenShareEnabled(false).catch(() => {}),
    [localParticipant],
  )

  // The dock manages its own host-or-cohost gating for "Start recording".
  // It also surfaces a waiting-room badge by counting pending users; the
  // host's waiting-room sidebar opens via the unread-badged "people" icon.
  return (
    <MeetingDock
      clock={clock}
      code={code}
      audioOn={micOn}
      toggleAudio={toggleMic}
      audioDeviceMenu={
        audioInputs.devices?.length > 1
          ? ({ close }) => (
              <LkDockDeviceMenu
                title="Microphone"
                devices={audioInputs.devices}
                current={audioInputs.activeDeviceId}
                onPick={async (id) => {
                  try { await audioInputs.setActiveMediaDevice(id) } catch { /* device removed */ }
                  close()
                }}
              />
            )
          : null
      }
      videoOn={camOn}
      toggleVideo={toggleCam}
      videoDeviceMenu={
        videoInputs.devices?.length > 1
          ? ({ close }) => (
              <LkDockDeviceMenu
                title="Camera"
                devices={videoInputs.devices}
                current={videoInputs.activeDeviceId}
                onPick={async (id) => {
                  try { await videoInputs.setActiveMediaDevice(id) } catch { /* device removed */ }
                  close()
                }}
              />
            )
          : null
      }
      screenOn={screenOn}
      screenshareEnabled={screenshareEnabled}
      isHostOrCohost={isHostOrCohost}
      startScreenShare={startShare}
      stopScreenShare={stopShare}
      isRecording={isRecording}
      startRecording={toggleRecording}
      stopRecording={toggleRecording}
      handRaised={handRaised}
      toggleHand={toggleHand}
      showEmoji={showEmoji}
      setShowEmoji={setShowEmoji}
      sendReaction={sendReaction}
      sidebar={sidebar}
      setSidebar={setSidebar}
      waitingList={waitingList}
      unreadChat={unreadChat}
      onInfo={openDevices}
      extraCenterSlot={
        <RoundDockExtra
          active={showWhiteboard}
          onClick={toggleWhiteboard}
          label={showWhiteboard ? 'Close whiteboard' : 'Open whiteboard'}
        >
          <PencilLine className="h-5 w-5" />
        </RoundDockExtra>
      }
      extraRightSlot={
        isHostOrCohost && unreadWaiting > 0 ? (
          <RoundDockExtra
            active={sidebar === 'waiting'}
            onClick={() => setSidebar((s) => (s === 'waiting' ? null : 'waiting'))}
            label="Waiting room"
            badge={unreadWaiting}
          >
            <Users className="h-5 w-5" />
          </RoundDockExtra>
        ) : null
      }
      leave={leave}
    />
  )
}

function RoundDockExtra({ active, onClick, label, badge, children }) {
  // Light styling matched to MeetingDock's capsule buttons so LiveKit-only
  // extras (whiteboard, waiting room) read as part of the same material.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={
        'relative grid h-[52px] w-[52px] place-items-center rounded-full transition active:scale-[0.94] ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b57d0]/45 [&_svg]:h-[22px] [&_svg]:w-[22px] ' +
        (active
          ? 'bg-[#c2e7ff] text-[#001d35] hover:bg-[#aed6fb]'
          : 'text-[#444746] hover:bg-black/[0.06] hover:text-[#1f1f1f]')
      }
    >
      {children}
      {badge > 0 && (
        <span className="pointer-events-none absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#ea4335] px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}

function fmtClock(d) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Device picker that hangs off the mic / camera caret in the dock.
 * Mirrors the mesh room's DockDeviceMenu visually so the affordance is
 * identical across both rooms; only the device-list source differs.
 */
function LkDockDeviceMenu({ title, devices, current, onPick }) {
  return (
    <div className="py-1.5">
      <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[#5f6368]">
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
                    ? 'bg-[#c2e7ff]/50 text-[#0b57d0]'
                    : 'text-[#202124] hover:bg-black/[0.05]')
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

function Header({ code, ctrlConnected, recording, isHostOrCohost, meeting, onLock, onChatEnabled, onScreenEnabled, onEnd }) {
  const state = useConnectionState()
  const [copied, setCopied] = useState(false)

  const reconnecting = state === ConnectionState.Reconnecting
  const connecting = state === ConnectionState.Connecting

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/meet/${code}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }

  // Transparent top bar that floats over the stage — matches the mesh
  // room's header and Meet's chromeless look.
  return (
    <div className="flex h-14 shrink-0 items-center justify-between px-4">
      <div className="flex items-center gap-2.5 text-sm">
        {recording && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ea4335]/15 px-2.5 py-1 text-[11px] font-semibold text-[#ea4335]">
            <span className="relative grid h-1.5 w-1.5 place-items-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
            </span>
            REC
          </span>
        )}
        {meeting?.locked && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-400" title="Meeting is locked">
            🔒 Locked
          </span>
        )}
        {(reconnecting || (!ctrlConnected && !connecting)) && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            Reconnecting…
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="font-mono text-[13px] tracking-wide text-[#444746]">{code}</span>
        <button
          onClick={copyLink}
          title="Copy invite link"
          aria-label="Copy invite link"
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-3 text-[12px] font-medium text-[#444746] shadow-sm transition hover:bg-[#f1f3f4]"
        >
          {copied ? '✓ Copied' : 'Copy link'}
        </button>
        {isHostOrCohost && (
          <HostMenu
            meeting={meeting}
            onToggleLock={onLock}
            onToggleChat={onChatEnabled}
            onToggleScreenshare={onScreenEnabled}
            onEndMeeting={onEnd}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Room-context-only side effects. Must live inside <LiveKitRoom> because it
 * uses room/local-participant hooks. Renders only transient toasts.
 */
function RoomEffects({ pushToast }) {
  const { localParticipant } = useLocalParticipant()
  const room = useRoomContext()

  // Apply persisted device prefs once the room is connected
  useEffect(() => {
    if (!room) return
    let cancelled = false
    let prefs = {}
    try { prefs = JSON.parse(localStorage.getItem('zoiko_devices_v1') || '{}') } catch { /* fine */ }
    ;(async () => {
      for (const kind of ['audioinput', 'videoinput', 'audiooutput']) {
        const id = prefs[kind]
        if (!id) continue
        try {
          if (cancelled) return
          await room.switchActiveDevice(kind, id)
        } catch { /* device may no longer be present — ignore */ }
      }
    })()
    return () => { cancelled = true }
  }, [room])

  // Participant join/leave toasts
  useRoomEvents({
    [RoomEvent.ParticipantConnected]: (p) => {
      pushToast({ kind: 'info', text: `${p.name || p.identity} joined` })
    },
    [RoomEvent.ParticipantDisconnected]: (p) => {
      pushToast({ kind: 'info', text: `${p.name || p.identity} left` })
    },
  })

  // Muted-but-speaking nudge — disabled for now: holding the mic via
  // getUserMedia while LiveKit also has the device caused intermittent
  // CLIENT_REQUEST_LEAVE disconnects on Windows + Docker Desktop. Re-enable
  // once we have a way to tap into LK's local audio track without owning
  // the device ourselves.
  const showMutedToast = false  // useMutedWhileSpeaking()

  // Keyboard shortcuts: Ctrl/Cmd + D = toggle mic, Ctrl/Cmd + E = toggle camera
  useEffect(() => {
    if (!localParticipant) return
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'd') {
        e.preventDefault()
        localParticipant.setMicrophoneEnabled(!localParticipant.isMicrophoneEnabled)
      } else if (k === 'e') {
        e.preventDefault()
        localParticipant.setCameraEnabled(!localParticipant.isCameraEnabled)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [localParticipant])

  if (!showMutedToast) return null
  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-zinc-800 text-zinc-100 px-3 py-2 rounded shadow text-sm z-30 flex items-center gap-2">
      <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
      You're muted — press <kbd className="px-1.5 py-0.5 text-xs rounded bg-zinc-700">Ctrl+D</kbd> to unmute
    </div>
  )
}

function ReconnectToast() {
  const state = useConnectionState()
  if (state !== ConnectionState.Reconnecting) return null
  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 bg-amber-600/95 text-white px-4 py-2 rounded shadow text-sm flex items-center gap-2 z-30">
      <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
      Reconnecting to the meeting…
    </div>
  )
}

function ToastStack({ toasts }) {
  if (!toasts?.length) return null
  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-30">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={
            'px-4 py-2 rounded shadow text-sm ' +
            (t.kind === 'error' ? 'bg-red-600/95 text-white' : 'bg-white text-[#202124] ring-1 ring-black/[0.06]')
          }
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}

function Splash({ text, children }) {
  return (
    <div className="h-screen w-screen grid place-items-center bg-[#f1f3f4] text-[#202124]">
      <div className="text-center">
        <div className="text-base">{text}</div>
        {children}
      </div>
    </div>
  )
}

