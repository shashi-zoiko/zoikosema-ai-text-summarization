import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
} from '@livekit/components-react'
import { ConnectionState, DisconnectReason, VideoPresets } from 'livekit-client'
import { Hand, MessageSquare, PencilLine, Settings, Smile, Users, UsersRound, Circle } from 'lucide-react'
import '@livekit/components-styles'

import { fetchMediaToken } from './api/media.js'
import { getRecordingState, startRecording, stopRecording } from './api/recording.js'
import { api } from '../../api/client.js'
import { useAuth } from '../../context/AuthContext.jsx'

import Stage from './components/Stage.jsx'
import ControlBar from './components/ControlBar.jsx'
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
import { useLocalParticipant, useRoomContext } from '@livekit/components-react'
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

const QUICK_EMOJIS = ['👍', '👏', '❤️', '😂', '🎉', '🙏']

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
        if (!cancelled) {
          setError(e?.message || 'Failed to join')
          setPhase('error')
        }
      }
    })()
    return () => { cancelled = true }
  }, [code])

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
      className="h-screen w-screen flex flex-col bg-zinc-950 text-white"
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

      <ControlBar
        onLeave={userLeave}
        rightSlot={
          <>
            <SmallBtn active={handRaised} onClick={toggleHand} title={handRaised ? 'Lower hand' : 'Raise hand'}>
              <Hand size={16} />
            </SmallBtn>
            <SmallBtn active={showEmoji} onClick={() => setShowEmoji((v) => !v)} title="React">
              <Smile size={16} />
            </SmallBtn>
            {isHostOrCohost && (
              <SmallBtn
                active={recording.recording}
                onClick={toggleRecord}
                title={recording.recording ? 'Stop recording' : 'Start recording'}
              >
                <Circle size={16} className={recording.recording ? 'text-red-400 fill-red-400' : ''} />
              </SmallBtn>
            )}
            {isHostOrCohost && (
              <SidebarToggle
                active={sidebar === 'waiting'}
                unread={unreadWaiting}
                onClick={() => setSidebar((s) => (s === 'waiting' ? null : 'waiting'))}
                title="Waiting room"
              >
                <Users size={16} />
              </SidebarToggle>
            )}
            <SidebarToggle
              active={sidebar === 'people'}
              unread={0}
              onClick={() => setSidebar((s) => (s === 'people' ? null : 'people'))}
              title="People"
            >
              <UsersRound size={16} />
            </SidebarToggle>
            <SidebarToggle
              active={sidebar === 'chat'}
              unread={unreadChat}
              onClick={() => setSidebar((s) => (s === 'chat' ? null : 'chat'))}
              title="Chat"
            >
              <MessageSquare size={16} />
            </SidebarToggle>
            <SmallBtn
              active={showWhiteboard}
              onClick={() => setShowWhiteboard((v) => !v)}
              title={showWhiteboard ? 'Close whiteboard' : 'Open whiteboard'}
            >
              <PencilLine size={16} />
            </SmallBtn>
            <SmallBtn onClick={() => setShowDevices(true)} title="Devices">
              <Settings size={16} />
            </SmallBtn>
          </>
        }
      />

      {showEmoji && (
        <div className="fixed bottom-20 right-6 z-30 flex gap-1 bg-zinc-900 border border-zinc-800 rounded-full px-3 py-2 shadow-xl">
          {QUICK_EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => sendReaction(e)}
              className="text-2xl w-9 h-9 grid place-items-center rounded-full hover:bg-zinc-800"
            >
              {e}
            </button>
          ))}
        </div>
      )}

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

function SmallBtn({ active, onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={
        'w-10 h-10 grid place-items-center rounded-full transition-colors ' +
        (active ? 'bg-blue-600 hover:bg-blue-700' : 'bg-zinc-700 hover:bg-zinc-600')
      }
    >
      {children}
    </button>
  )
}

function SidebarToggle({ active, unread, onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={
        'relative w-10 h-10 grid place-items-center rounded-full transition-colors ' +
        (active ? 'bg-blue-600 hover:bg-blue-700' : 'bg-zinc-700 hover:bg-zinc-600')
      }
    >
      {children}
      {unread > 0 && !active && (
        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] min-w-4.5 h-4.5 grid place-items-center rounded-full px-1">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  )
}

function Header({ code, ctrlConnected, recording, isHostOrCohost, meeting, onLock, onChatEnabled, onScreenEnabled, onEnd }) {
  const state = useConnectionState()
  const mediaLabel =
    state === ConnectionState.Connected
      ? 'Connected'
      : state === ConnectionState.Reconnecting
        ? 'Reconnecting…'
        : state === ConnectionState.Connecting
          ? 'Connecting…'
          : state
  const dotColor =
    state === ConnectionState.Connected
      ? 'bg-emerald-500'
      : state === ConnectionState.Reconnecting
        ? 'bg-amber-500'
        : 'bg-zinc-500'
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800">
      <div className="text-sm text-zinc-300 flex items-center gap-3">
        <span>Meeting <span className="font-mono text-zinc-100">{code}</span></span>
        {recording && (
          <span className="flex items-center gap-1 text-xs text-red-400">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            REC
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-zinc-300">
        <span className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${dotColor}`} />
          {mediaLabel}
        </span>
        <span className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${ctrlConnected ? 'bg-emerald-500' : 'bg-zinc-500'}`} />
          Chat
        </span>
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
            (t.kind === 'error' ? 'bg-red-600/95 text-white' : 'bg-zinc-800 text-zinc-100')
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
    <div className="h-screen w-screen grid place-items-center bg-zinc-950 text-zinc-200">
      <div className="text-center">
        <div className="text-base">{text}</div>
        {children}
      </div>
    </div>
  )
}

