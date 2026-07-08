import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { meetingPath, meetingLeftPath } from '../../lib/meetingUrls.js'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
} from '@livekit/components-react'
import { ConnectionState, DisconnectReason, ScreenSharePresets, Track, VideoPresets } from 'livekit-client'
import { PencilLine } from 'lucide-react'
import '@livekit/components-styles'

import { fetchMediaToken } from './api/media.js'
import { getRecordingState, startRecording, stopRecording } from './api/recording.js'
import { api } from '../../api/client.js'
import { useAuth } from '../../context/AuthContext.jsx'

import Stage from './components/Stage.jsx'
import PresenterBanner from './components/PresenterBanner.jsx'
import PresenterPiP from './components/PresenterPiP.jsx'
import MeetingDock from '../../components/meeting/MeetingDock.jsx'
import MeetingHeader from './components/MeetingHeader.jsx'
import ChatPanel from './components/ChatPanel.jsx'
import ReactionOverlay from './components/ReactionOverlay.jsx'
import ParticipantsPanel from './components/ParticipantsPanel.jsx'
import SettingsDrawer from './components/SettingsDrawer.jsx'
import MeetingInfoDrawer from './components/MeetingInfoDrawer.jsx'
import CaptionProvider from './captions/CaptionProvider.jsx'
import CaptionOverlay from './captions/CaptionOverlay.jsx'
import { useCaptionControls } from './captions/useCaptions.js'
import { backgroundEffectsSupported } from './backgroundEngine.js'
import { getPreset, NONE_EFFECT } from './backgroundPresets.js'
import { LkBackgroundProcessor } from './lkBackgroundProcessor.js'
// Private per-participant notebook (rich-text notes + personal drawing canvas).
// Lazy-loaded so the TipTap editor bundle isn't in the initial meeting load.
const PrivateNotebook = lazy(() => import('./notebook/PrivateNotebook.jsx'))
import useMeetingControlWs from './hooks/useMeetingControlWs.js'
import useRoomEvents, { RoomEvent } from './hooks/useRoomEvents.js'
import { useLocalParticipant, useMediaDeviceSelect, useRoomContext } from '@livekit/components-react'
import { useRoomStore } from './state/roomStore.js'
import { NotificationProvider, useNotifications } from './notify/NotificationProvider.jsx'
import { soundManager } from './notify/sounds.js'
import MeetingCryptoProvider from './e2ee/MeetingCryptoProvider.jsx'
import { createE2EERoom, armMediaE2EE, MediaE2EEStatus } from './e2ee/MediaE2EE.jsx'
import { encryptMessage, decryptMessage, importMessageKey, mediaE2EESupported } from './e2ee/messageCrypto.js'

// Flat enterprise canvas — one fixed dark theme, no meeting-wide theme picker,
// no ambient green wash. The surface tokens live in index.css (.zk-room-bg etc.).
const CANVAS = '#0B1220'

// Cap the in-memory chat log so a long, busy meeting can't grow it without
// bound (each append copies the whole array and ChatPanel re-diffs the full
// list). In-call chat is ephemeral — it's never persisted server-side — so
// dropping the oldest messages loses nothing durable; no one scrolls back
// through hundreds of lines mid-call. Mirrors the existing caps on reactions
// (roomStore.js) and captions (CaptionOverlay.jsx). Raise/lower here.
const MAX_CHAT_MESSAGES = 500

const ROOM_OPTIONS = {
  adaptiveStream: true,
  dynacast: true,
  publishDefaults: {
    simulcast: true,
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360, VideoPresets.h720],
    // Screen-share publish defaults — keep shared content sharp. Camera tracks
    // top out at 720p (above) because faces don't need more, but a shared screen
    // is full of fine text/UI, so it gets its own high-bitrate ladder and is
    // told to drop frame-rate before resolution (text legibility > motion).
    screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
    screenShareSimulcastLayers: [ScreenSharePresets.h720fps15, ScreenSharePresets.h1080fps30],
    degradationPreference: 'maintain-resolution',
    dtx: true,
    red: true,
  },
  videoCaptureDefaults: {
    resolution: VideoPresets.h720.resolution,
  },
}

// Screen-capture request — ask the browser for a high-res, high-fps surface and
// hint the encoder that the content is detailed text/UI (not motion video) so it
// favours sharpness over smoothness. `surfaceSwitching`/`selfBrowserSurface` let
// the presenter swap the shared tab without re-opening the picker.
const SCREEN_CAPTURE_OPTIONS = {
  audio: true,
  contentHint: 'detail',
  resolution: VideoPresets.h1440.resolution, // 2560×1440 target
  selfBrowserSurface: 'include',
  surfaceSwitching: 'include',
  systemAudio: 'include',
}

// Per-publish overrides applied when screen-share starts (mirrors the room
// defaults but pins them at the call site so they win regardless of defaults).
const SCREEN_PUBLISH_OPTIONS = {
  simulcast: true,
  videoEncoding: ScreenSharePresets.h1080fps30.encoding,
  screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
  screenShareSimulcastLayers: [ScreenSharePresets.h720fps15, ScreenSharePresets.h1080fps30],
  degradationPreference: 'maintain-resolution',
}

export default function MeetRoomLivekit() {
  // The notification engine wraps the whole room so toasts/lobby cards/sounds
  // are available to the room body AND to LiveKit-context children (join/leave).
  return (
    <NotificationProvider>
      <MeetRoom />
    </NotificationProvider>
  )
}

function MeetRoom() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { user, isGuest, guest, joinAsGuest } = useAuth()
  const { notify, notifyChat, syncLobby, registerLobbyActions } = useNotifications()

  // Mic/camera choice the user made in the lobby (persisted there before
  // navigating). The room must honour it — hardcoding `audio video` on
  // <LiveKitRoom> force-enabled both on join AND on every refresh, overriding
  // a user who joined muted / camera-off.
  const joinPrefs = useMemo(() => {
    try { return JSON.parse(sessionStorage.getItem(`zoiko_meet_prefs_${code}`) || '{}') } catch { return {} }
  }, [code])

  // Connection bootstrap
  const [token, setToken] = useState(null)
  const [wsUrl, setWsUrl] = useState(null)
  const [error, setError] = useState(null)
  const [phase, setPhase] = useState('joining') // joining | connecting | live | error | left

  // ── End-to-end encryption ────────────────────────────────────────────────
  // Per-meeting key from /media-token — the same value for every participant,
  // derived server-side, never exchanged between clients. Drives BOTH the
  // LiveKit media E2EE (via the key provider) and the AES-GCM text channels
  // (chat + captions). When the browser can't do insertable-stream E2EE we
  // refuse to connect rather than silently sending unencrypted media (E2EE is
  // non-negotiable here).
  const [e2eeKey, setE2eeKey] = useState(null)
  // We OWN the Room so E2EE can be armed BEFORE it connects — otherwise the
  // first mic/camera track would publish unencrypted in the window before
  // setE2EEEnabled takes effect. `connect` on <LiveKitRoom> is gated on
  // `e2eeArmed`, so no frame is ever sent in the clear.
  const e2eeRoom = useMemo(
    () => (mediaE2EESupported() ? createE2EERoom(ROOM_OPTIONS) : null),
    [],
  )
  const [e2eeArmed, setE2eeArmed] = useState(false)
  // Imported CryptoKey for chat (send + receive both live in this component, so
  // chat crypto stays local; captions get the key through MeetingCryptoProvider).
  const chatKeyRef = useRef(null)
  useEffect(() => {
    let cancelled = false
    if (!e2eeKey) { chatKeyRef.current = null; return undefined }
    ;(async () => {
      try {
        const k = await importMessageKey(e2eeKey)
        if (!cancelled) chatKeyRef.current = k
      } catch { chatKeyRef.current = null }
    })()
    return () => { cancelled = true }
  }, [e2eeKey])
  // Arm media E2EE (set key + enable) as soon as the key lands, THEN allow the
  // room to connect. If the browser refuses, surface an error instead of
  // connecting unencrypted.
  useEffect(() => {
    if (!e2eeRoom || !e2eeKey) return undefined
    let cancelled = false
    ;(async () => {
      try {
        await armMediaE2EE(e2eeRoom.room, e2eeRoom.keyProvider, e2eeKey)
        if (!cancelled) setE2eeArmed(true)
      } catch (e) {
        if (import.meta.env.DEV) console.error('[e2ee] failed to arm media E2EE', e)
        if (!cancelled) {
          setError('Could not enable end-to-end encryption on this device. The meeting was not joined unencrypted.')
          setPhase('error')
        }
      }
    })()
    return () => { cancelled = true }
  }, [e2eeRoom, e2eeKey])
  // Terminate the E2EE crypto worker when the room unmounts.
  useEffect(() => () => { try { e2eeRoom?.worker?.terminate() } catch { /* already gone */ } }, [e2eeRoom])

  // App state from the control WS
  const [isHost, setIsHost] = useState(false)
  const [myRole, setMyRole] = useState('participant')
  const [meeting, setMeeting] = useState({
    locked: false,
    chat_enabled: true,
    screenshare_enabled: true,
  })
  const [handRaised, setHandRaised] = useState(false)
  const [recording, setRecording] = useState({ recording: false, recording_id: null })

  // Local UI state
  const [sidebar, setSidebar] = useState(null) // 'chat' | 'people' | 'info' | 'settings' | null
  // Bumped whenever the header admit-chip / lobby "open" is used, so the People
  // panel scrolls its waiting section into view.
  const [waitingScrollSignal, setWaitingScrollSignal] = useState(0)
  const [settingsTab, setSettingsTab] = useState('audio') // active tab when sidebar==='settings'
  // Per-viewer grid/speaker preference (local only, never synced).
  const [layout, setLayout] = useState('grid') // 'grid' | 'speaker'

  // Virtual background — LOCAL per-participant camera effect (blur / image),
  // applied via a LiveKit track processor. Persisted across sessions.
  const bgSupported = backgroundEffectsSupported()
  const [bgEffectId, setBgEffectId] = useState(() => {
    try { return localStorage.getItem('zoiko_bg_effect') || 'none' } catch { return 'none' }
  })
  const [bgUploads, setBgUploads] = useState([])
  const [bgLoading, setBgLoading] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [chatMessages, setChatMessages] = useState([])
  const [unreadChat, setUnreadChat] = useState(0)
  const [showEmoji, setShowEmoji] = useState(false)
  const [showWhiteboard, setShowWhiteboard] = useState(false)
  const joinedAtRef = useRef(null) // wall-clock ms when media token landed → header timer
  // Bridge the legacy { kind, text } toast API onto the notification engine so
  // recording / permission-denied / error paths keep working unchanged.
  const setToast = useCallback(({ kind, text, title } = {}) => {
    const type = kind === 'error' ? 'error' : kind === 'success' ? 'success' : 'info'
    notify(type, { title, text })
  }, [notify])
  const msgKeyRef = useRef(0)

  // Waiting list lives in the store (see roomStore) — header chip, People panel
  // and dock badge all read it via selectors instead of prop-drilling.
  const waiting = useRoomStore((s) => s.waiting)
  const setWaiting = useRoomStore((s) => s.setWaiting)
  const reactions = useRoomStore((s) => s.reactions)
  const raisedHandsCount = useRoomStore((s) => s.raisedHands.size)
  const pushReaction = useRoomStore((s) => s.pushReaction)
  const setHand = useRoomStore((s) => s.setHand)
  const setRole = useRoomStore((s) => s.setRole)
  const seedRoles = useRoomStore((s) => s.seedRoles)
  const resetRoom = useRoomStore((s) => s.reset)

  // Wipe carried-over reactions/pins/hands/roles when entering a meeting — the
  // store is module-global, so otherwise the last meeting's state leaks in.
  useEffect(() => { resetRoom() }, [resetRoom])

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
        if (data.user_id === user?.id) {
          setMyRole(data.role)
          notify('host-transfer', {
            title: data.role === 'co_host' ? 'You are now a co-host' : 'Co-host role removed',
            text: data.role === 'co_host'
              ? 'You can admit guests and manage the meeting.'
              : 'Your co-host privileges were removed.',
          })
        }
      } else if (t === 'chat') {
        // Decrypt the E2E envelope before it enters app state. An undecryptable
        // payload (wrong key / tampered) is dropped rather than shown as raw
        // ciphertext. The notify/mention logic all runs on the decrypted text.
        const showChat = (plainBody) => {
          const msg = { ...data, body: plainBody, _key: ++msgKeyRef.current }
          setChatMessages((prev) => {
            const next = [...prev, msg]
            // Keep only the most recent MAX_CHAT_MESSAGES so a 3-4h meeting
            // can't grow this array (and the ChatPanel re-render cost) forever.
            return next.length > MAX_CHAT_MESSAGES
              ? next.slice(next.length - MAX_CHAT_MESSAGES)
              : next
          })
          // Sound + badge + toast only for OTHERS' messages (the server echoes
          // the sender's own message back to them). When the chat panel is
          // already open we stay silent unless it's a direct @mention — the
          // user is already reading, so a sound/toast per message would be noise.
          if (data.user_id !== user?.id) {
            const chatClosed = sidebar !== 'chat'
            const mention = mentionsMe(plainBody, user?.name)
            if (chatClosed) setUnreadChat((n) => n + 1)
            // Teams-style floating card (bottom-right) with avatar + preview.
            // Fired when chat is closed, or on an @mention even if it's open.
            if (chatClosed || mention) {
              notifyChat({ name: data.name || 'Someone', color: data.color, body: plainBody, mention })
            }
          }
        }
        const key = chatKeyRef.current
        if (key) {
          decryptMessage(key, data.body).then((plain) => { if (plain != null) showChat(plain) })
        } else {
          showChat(data.body)
        }
      } else if (t === 'reaction') {
        pushReaction({ peer_id: data.peer_id, user_id: data.user_id, name: data.name, emoji: data.emoji })
      } else if (t === 'raise-hand') {
        if (typeof data.user_id === 'number') setHand(data.user_id, !!data.raised)
        if (data.raised && data.user_id !== user?.id) {
          notify('hand', { emoji: '✋', title: 'Hand raised', text: `${data.name || 'Someone'} raised their hand` })
        }
      } else if (t === 'waiting-room') {
        const list = Array.isArray(data.waiting) ? data.waiting : []
        setWaiting(list)
        syncLobby(list) // drives the persistent lobby request cards + lobby sound
      } else if (t === 'recording') {
        setRecording({ recording: !!data.recording, recording_id: data.recording_id ?? null })
        // The host who toggled already saw a confirmation toast; notify the rest.
        if (data.by !== user?.id) {
          notify('recording', {
            accent: data.recording ? 'red' : 'slate',
            title: data.recording ? 'Recording started' : 'Recording stopped',
            text: data.recording ? 'This meeting is now being recorded.' : undefined,
          })
        }
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
        // Guests have no app shell to return to (/ is auth-gated), so send
        // them back to the public lobby which will show the "ended" state.
        const dest = isGuest ? meetingPath(code) : '/'
        setTimeout(() => navigate(dest, { replace: true }), 1500)
      } else if (t === 'permission-denied') {
        setToast({ kind: 'error', text: data.reason || 'Action not allowed' })
      }
      // NOTE: live captions no longer travel on the control WS — they ride the
      // LiveKit data channel (see captions/CaptionProvider). The server 'caption'
      // relay is left intact as a documented fallback transport.
    })
  }, [ctrlSubscribe, sidebar, navigate, user?.id, user?.name, pushReaction, setHand, setRole, seedRoles, notify, notifyChat, syncLobby])

  useEffect(() => { if (sidebar === 'chat') setUnreadChat(0) }, [sidebar])

  // ── Media-token mint flow ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    // Hard gate: this meeting is end-to-end encrypted, and a browser without
    // insertable-stream support can't encrypt media frames. Refuse to join
    // rather than downgrade to unencrypted media.
    if (!e2eeRoom) {
      setError(
        'This meeting is end-to-end encrypted, which your browser doesn’t support. ' +
        'Please join from an up-to-date Chrome, Edge, or Safari 15.4+.',
      )
      setPhase('error')
      return
    }
    ;(async () => {
      // Guest reconnect: if the guest's short-lived token expired (e.g. a long
      // background tab) the join/media-token calls 401. Re-mint silently using
      // the remembered guest name, then retry once before surfacing an error.
      const tryJoin = async () => {
        await api(`/api/meetings/${code}/join`, { method: 'POST' })
        return fetchMediaToken(code)
      }
      try {
        let t
        try {
          t = await tryJoin()
        } catch (e) {
          const credErr = /credential|401|unauthor/i.test(e?.message || '')
          if (credErr && isGuest && guest?.code === code && guest?.name) {
            await joinAsGuest(code, { displayName: guest.name })
            t = await tryJoin()
          } else {
            throw e
          }
        }
        if (cancelled) return
        setToken(t.access_token)
        setWsUrl(t.ws_url)
        setE2eeKey(t.e2ee_key || null)
        joinedAtRef.current = Date.now()
        setPhase('connecting')
        // Probe recording state (host UI uses this on mount)
        try { setRecording(await getRecordingState(code)) } catch { /* ignore */ }
      } catch (e) {
        if (cancelled) return
        const msg = e?.message || 'Failed to join'
        // LiveKit is the only media plane — there's no mesh room to fall back
        // to. A 503 here means the server is missing MEDIA_PROVIDER=livekit /
        // LIVEKIT_* credentials; surface a clear message so it's fixed in ops
        // rather than silently degrading.
        if (/livekit is not enabled/i.test(msg)) {
          setError('Live video is temporarily unavailable. The meeting server is not configured for video right now — please try again shortly.')
          setPhase('error')
          return
        }
        setError(msg)
        setPhase('error')
      }
    })()
    return () => { cancelled = true }
  }, [code, navigate])

  // ── Actions ──────────────────────────────────────────────────────────────
  // Chat is end-to-end encrypted: encrypt the body with the per-meeting key
  // before it touches the control WS. The server relays the ciphertext and
  // never sees the plaintext. If the secure channel isn't ready yet we refuse
  // to send rather than fall back to plaintext.
  const sendChat = useCallback(async (body) => {
    const key = chatKeyRef.current
    if (!key) {
      setToast({ kind: 'error', text: 'Secure channel not ready yet — try again in a moment.' })
      return
    }
    const envelope = await encryptMessage(key, body)
    ctrlSend({ type: 'chat', body: envelope })
  }, [ctrlSend, setToast])
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
  // Admit / deny go over REST (reliable: the request always lands and returns a
  // status the button can reflect). The endpoint now PUSHES an 'admitted' event
  // to the waiting socket and wakes its hold loop instantly, so the user joins
  // in < 1s with no polling. We also drop the row locally for instant host UI;
  // the authoritative list re-syncs via the 'waiting-room' WS broadcast.
  const admitUser = useCallback(async (uid) => {
    try {
      await api(`/api/meetings/${code}/admit`, { method: 'POST', body: { user_id: uid } })
      setWaiting((prev) => prev.filter((w) => w.user_id !== uid))
    } catch (e) {
      setToast({ kind: 'error', text: e?.message || 'Could not admit participant' })
    }
  }, [code])
  const denyUser = useCallback(async (uid) => {
    try {
      await api(`/api/meetings/${code}/deny`, { method: 'POST', body: { user_id: uid } })
      setWaiting((prev) => prev.filter((w) => w.user_id !== uid))
    } catch (e) {
      setToast({ kind: 'error', text: e?.message || 'Could not deny participant' })
    }
  }, [code])
  // Admit everyone in ONE batch request — no per-user N+1 round-trips. The
  // server admits all pending rows in a single transaction and pushes each
  // waiting user instantly.
  const admitAll = useCallback(async () => {
    setWaiting([])
    try {
      await api(`/api/meetings/${code}/admit-all`, { method: 'POST' })
    } catch (e) {
      setToast({ kind: 'error', text: e?.message || 'Could not admit everyone' })
      // list re-syncs from the next 'waiting-room' WS broadcast
    }
  }, [code])
  // Open the People panel and scroll to the waiting section (header chip + lobby
  // "open" both route here). Bump the signal so the panel scrolls even if it's
  // already open.
  const openPeopleWaiting = useCallback(() => {
    setSidebar('people')
    setWaitingScrollSignal((n) => n + 1)
  }, [])
  // Google-Meet: clicking the grid's "+N others" tile opens the People panel.
  const openPeople = useCallback(() => setSidebar('people'), [])
  // Let the lobby notification cards drive admit/deny and "open waiting room".
  useEffect(() => {
    registerLobbyActions({
      onAdmit: admitUser,
      onDeny: denyUser,
      onOpen: openPeopleWaiting,
      // "Mark as read" on a chat card clears the unread badge without opening
      // chat; tapping a card's preview opens the chat drawer (which also clears).
      onChatRead: () => setUnreadChat(0),
      onOpenChat: () => setSidebar('chat'),
    })
  }, [registerLobbyActions, admitUser, denyUser, openPeopleWaiting])

  // ponytail: host "remove participant" (kick) was removed — no kick action.
  const promoteUser = useCallback((uid) => ctrlSend({ type: 'promote', user_id: uid }), [ctrlSend])
  const setLock = useCallback((locked) => ctrlSend({ type: 'lock', locked }), [ctrlSend])
  const toggleLayout = useCallback(() => {
    setLayout((l) => (l === 'grid' ? 'speaker' : 'grid'))
  }, [])
  // Background is local-only (no WS broadcast). Persist the choice; the
  // VirtualBackgroundController inside <LiveKitRoom> applies it to the camera.
  const changeBgEffect = useCallback((preset) => {
    const id = preset?.id || 'none'
    setBgEffectId(id)
    try { localStorage.setItem('zoiko_bg_effect', id) } catch { /* private mode */ }
  }, [])
  const addUpload = useCallback((file) => {
    if (!file) return
    const url = URL.createObjectURL(file)
    const id = `upload-${url.slice(-12)}`
    const preset = { id, name: file.name || 'Custom', type: 'image', src: url }
    setBgUploads((prev) => [...prev, preset])
    changeBgEffect(preset)
  }, [changeBgEffect])
  // Resolve the active effect object from its id (built-in preset or upload).
  const bgEffect =
    bgEffectId === 'none'
      ? NONE_EFFECT
      : (getPreset(bgEffectId) || bgUploads.find((u) => u.id === bgEffectId) || NONE_EFFECT)
  const setChatEnabled = useCallback((v) => ctrlSend({ type: 'set-permissions', chat_enabled: v }), [ctrlSend])
  const setScreenEnabled = useCallback((v) => ctrlSend({ type: 'set-permissions', screenshare_enabled: v }), [ctrlSend])
  // ponytail: "end meeting for all" removed — a host leaving only disconnects
  // themselves (Google-Meet style); the meeting stays live for everyone else.

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
    // Google-Meet-style hang-up tone. Played via the shared SoundManager (a
    // detached <audio> element) so it keeps sounding after we navigate away and
    // this component unmounts.
    soundManager.play('call-end')
    setPhase('left')
    // User-initiated leave → the "you left the meeting" exit screen (Rejoin /
    // Home). Only this path shows it; auth-expiry / server errors go to the
    // error splash, and host-ended / removed go home (handled below).
    navigate(meetingLeftPath(code), { replace: true })
  }, [navigate, code])

  const handleDisconnected = useCallback((reason) => {
    // Only navigate when the user actually clicked Leave OR the SFU
    // rejected/kicked us. CLIENT_INITIATED with userLeftRef=false is the
    // Strict Mode double-mount case — stay put and let the remount reconnect.
    if (userLeftRef.current) {
      // userLeave already routed to the exit screen; re-assert (idempotent
      // replace) in case the disconnect beat the navigation.
      navigate(meetingLeftPath(code), { replace: true })
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
      // Play the hang-up tone when the meeting ends for everyone (host ended /
      // server shut the room down) or we're removed — same goodbye cue as
      // clicking Leave yourself. Skip the duplicate-tab case (not a real exit).
      if (reason !== DisconnectReason.DUPLICATE_IDENTITY) soundManager.play('call-end')
      setPhase('left')
      setTimeout(() => navigate('/', { replace: true }), 1500)
    }
    // Anything else (CLIENT_INITIATED w/o user leave) — silently ignored;
    // LiveKitRoom will reconnect if it can, or stay disconnected.
  }, [navigate, code])

  const isHostOrCohost = isHost || myRole === 'co_host'

  // ── Render gates ─────────────────────────────────────────────────────────
  if (phase === 'joining' || (phase === 'connecting' && !token)) {
    return <Splash text="Joining meeting…" />
  }
  if (phase === 'error') {
    return (
      <Splash text={error || 'Failed to join'}>
        <button
          onClick={() => navigate('/')}
          className="mt-5 rounded-xl border border-[#263244] bg-[#1E293B] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#263244]"
        >
          Back to meetings
        </button>
      </Splash>
    )
  }

  return (
    // Dark token scope for the whole room subtree — bare elements (scrollbars,
    // any un-classed control) resolve to the dark design tokens, and the global
    // base `button` rule paints from the dark palette instead of light.
    <div data-theme="midnight" className="contents">
    <LiveKitRoom
      room={e2eeRoom?.room}
      token={token}
      serverUrl={wsUrl}
      connect={e2eeArmed}
      audio={joinPrefs.audio !== false}
      video={joinPrefs.video !== false}
      onDisconnected={handleDisconnected}
      onError={(e) => setError(e?.message || String(e))}
      className="zk-room-bg flex h-dvh w-screen flex-col overflow-hidden overscroll-none text-white"
      style={{ background: CANVAS }}
    >
      {/* Dev-only: reports the room's REAL E2EE status once the frame cryptor
          engages (stripped from production builds). */}
      <MediaE2EEStatus />
      {/* MeetingCryptoProvider shares the text-channel key with captions (deep
          in the tree). CaptionProvider must live inside <LiveKitRoom> (it uses
          the local participant + data channel). Both only render context
          providers around their children, so caption updates never re-render
          the grid. */}
      <MeetingCryptoProvider keyB64={e2eeKey}>
      <CaptionProvider>
      <MeetingHeader
        code={code}
        ctrlConnected={ctrlConnected}
        recording={recording.recording}
        locked={meeting.locked}
        joinedAt={joinedAtRef.current}
        isHostOrCohost={isHostOrCohost}
        meeting={meeting}
        onLock={setLock}
        onChatEnabled={setChatEnabled}
        onScreenEnabled={setScreenEnabled}
        onOpenInfo={() => setSidebar((s) => (s === 'info' ? null : 'info'))}
        onOpenPeople={openPeopleWaiting}
      />

      <div className="relative flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <Stage layout={layout} onOpenPeople={openPeople} />
          <PresenterBanner />
          <PresenterPiP />
          <ReactionOverlay events={reactions} />
          <CaptionOverlay />
          {showWhiteboard && (
            <div className="pointer-events-none absolute inset-0 z-20">
              <Suspense fallback={null}>
                <PrivateNotebook
                  code={code}
                  userId={user?.id}
                  onClose={() => setShowWhiteboard(false)}
                />
              </Suspense>
            </div>
          )}
        </div>
        {sidebar === 'chat' && (
          <ChatPanel
            messages={chatMessages}
            onSend={sendChat}
            onClose={() => setSidebar(null)}
            selfUserId={user?.id}
            disabled={!meeting.chat_enabled && !isHostOrCohost}
          />
        )}
        {sidebar === 'people' && (
          <ParticipantsPanel
            selfUserId={user?.id}
            isHost={isHost}
            isHostOrCohost={isHostOrCohost}
            onClose={() => setSidebar(null)}
            onPromote={promoteUser}
            onAdmit={admitUser}
            onDeny={denyUser}
            onAdmitAll={admitAll}
            scrollWaitingSignal={waitingScrollSignal}
          />
        )}
        {sidebar === 'info' && (
          <MeetingInfoDrawer
            code={code}
            joinedAt={joinedAtRef.current}
            onClose={() => setSidebar(null)}
          />
        )}
        {sidebar === 'settings' && (
          <SettingsDrawer
            onClose={() => setSidebar(null)}
            tab={settingsTab}
            onTab={setSettingsTab}
            bgEffectId={bgEffectId}
            onSelectBg={changeBgEffect}
            bgLoading={bgLoading}
            bgSupported={bgSupported}
            uploads={bgUploads}
            onUpload={addUpload}
            cameraOn={cameraOn}
          />
        )}
      </div>

      <RoomAudioRenderer />

      <LivekitDockAdapter
        code={code}
        isHostOrCohost={isHostOrCohost}
        screenshareEnabled={meeting.screenshare_enabled}
        layout={layout}
        toggleLayout={toggleLayout}
        sidebar={sidebar}
        setSidebar={setSidebar}
        waitingList={isHostOrCohost ? waiting : []}
        unreadChat={unreadChat}
        raisedHands={raisedHandsCount}
        handRaised={handRaised}
        toggleHand={toggleHand}
        showEmoji={showEmoji}
        setShowEmoji={setShowEmoji}
        sendReaction={sendReaction}
        isRecording={recording.recording}
        toggleRecording={toggleRecord}
        showWhiteboard={showWhiteboard}
        toggleWhiteboard={() => setShowWhiteboard((v) => !v)}
        openInfo={() => setSidebar((s) => (s === 'info' ? null : 'info'))}
        openBackgrounds={() => { setSettingsTab('backgrounds'); setSidebar('settings') }}
        leave={userLeave}
      />

      <RoomEffects />
      <VirtualBackgroundController effect={bgEffect} setLoading={setBgLoading} onCameraState={setCameraOn} />
      <ReconnectToast />
      {error && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 rounded-xl bg-[#EF4444] px-3.5 py-2 text-sm font-medium text-white shadow-lg">
          {error}
        </div>
      )}
      </CaptionProvider>
      </MeetingCryptoProvider>
    </LiveKitRoom>
    </div>
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
  layout,
  toggleLayout,
  sidebar,
  setSidebar,
  waitingList,
  unreadChat,
  raisedHands,
  handRaised,
  toggleHand,
  showEmoji,
  setShowEmoji,
  sendReaction,
  isRecording,
  toggleRecording,
  showWhiteboard,
  toggleWhiteboard,
  openInfo,
  openBackgrounds,
  leave,
}) {
  const { localParticipant } = useLocalParticipant()
  const { notify } = useNotifications()
  const audioInputs = useMediaDeviceSelect({ kind: 'audioinput' })
  const videoInputs = useMediaDeviceSelect({ kind: 'videoinput' })
  // Caption on/off + support state. This context value changes only on toggle,
  // so threading it through the dock never causes caption-frame re-renders.
  const { enabled: captionsOn, supported: captionsSupported, toggle: toggleCaptions } = useCaptionControls()

  const micOn = !!localParticipant?.isMicrophoneEnabled
  const camOn = !!localParticipant?.isCameraEnabled
  const screenOn = !!localParticipant?.isScreenShareEnabled
  // Capability check (NOT user-agent sniffing): iPhone Safari has no
  // getDisplayMedia, so screen-share is impossible there. iPadOS and desktop
  // expose it. Used to fail gracefully with a toast instead of silently.
  const screenShareSupported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function'

  const toggleMic = useCallback(
    () => localParticipant?.setMicrophoneEnabled(!micOn).catch(() => {}),
    [localParticipant, micOn],
  )
  const toggleCam = useCallback(
    () => localParticipant?.setCameraEnabled(!camOn).catch(() => {}),
    [localParticipant, camOn],
  )
  const startShare = useCallback(async () => {
    if (!localParticipant) return
    // iPhone Safari can't share a screen at all — surface a clear message
    // rather than failing silently when the user taps the button.
    if (!screenShareSupported) {
      notify('error', {
        title: 'Screen sharing unavailable',
        text: 'Screen sharing isn’t supported on this device. Try a desktop browser or iPad.',
      })
      return
    }
    try {
      await localParticipant.setScreenShareEnabled(
        true,
        SCREEN_CAPTURE_OPTIONS,
        SCREEN_PUBLISH_OPTIONS,
      )
      // Reassert the detail hint on the raw MediaStreamTrack — some browsers
      // reset it after getDisplayMedia, which would let the encoder treat the
      // share like motion video and blur the text.
      const pub = localParticipant.getTrackPublication?.(Track.Source.ScreenShare)
      const mst = pub?.track?.mediaStreamTrack
      if (mst && 'contentHint' in mst) mst.contentHint = 'detail'
    } catch {
      /* user dismissed the picker, or no permission — nothing to do */
    }
  }, [localParticipant, screenShareSupported, notify])
  const stopShare = useCallback(
    () => localParticipant?.setScreenShareEnabled(false).catch(() => {}),
    [localParticipant],
  )

  return (
    <MeetingDock
      code={code}
      audioOn={micOn}
      toggleAudio={toggleMic}
      audioDeviceMenu={
        // Own caret on the mic button — shown whenever a mic is available so the
        // chevron is always present alongside the camera's.
        audioInputs.devices?.length > 0
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
        // Own caret on the camera button — mirrors the mic caret.
        videoInputs.devices?.length > 0
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
      isRecording={false}
      startRecording={undefined}
      stopRecording={undefined}
      handRaised={handRaised}
      toggleHand={toggleHand}
      captionsOn={captionsOn}
      toggleCaptions={toggleCaptions}
      captionsSupported={captionsSupported}
      showEmoji={showEmoji}
      setShowEmoji={setShowEmoji}
      sendReaction={sendReaction}
      layout={layout}
      toggleLayout={toggleLayout}
      sidebar={sidebar}
      setSidebar={setSidebar}
      unreadChat={unreadChat}
      peopleBadge={(waitingList?.length || 0) + raisedHands}
      // Waiting-room requests are the more urgent reason to open People, so they
      // win the accent (emerald); otherwise raised hands tint it amber.
      peopleAccent={(waitingList?.length || 0) > 0 ? 'emerald' : raisedHands > 0 ? 'amber' : 'red'}
      onInfo={openInfo}
      openBackgrounds={openBackgrounds}
      extraCenterSlot={
        <RoundDockExtra
          active={showWhiteboard}
          onClick={toggleWhiteboard}
          label={showWhiteboard ? 'Close notes' : 'Private notes & whiteboard'}
        >
          <PencilLine className="h-5 w-5" />
        </RoundDockExtra>
      }
      leave={leave}
    />
  )
}

function RoundDockExtra({ active, onClick, label, badge, side, glow = false, children }) {
  // Dark dock extras (whiteboard, waiting room) matched to MeetingDock's chips.
  const glowCls = glow && !active ? ' zk-unread-glow ring-1 ring-[#EF4444]/50' : ''
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={
        'relative grid h-12 w-12 sm:h-[52px] sm:w-[52px] place-items-center rounded-full touch-manipulation transition active:scale-[0.94] ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]/45 [&_svg]:h-5 [&_svg]:w-5 sm:[&_svg]:h-[22px] sm:[&_svg]:w-[22px] ' +
        (active
          ? 'bg-[#10B981]/20 text-[#34D399] ring-1 ring-[#10B981]/40'
          : 'text-[#94A3B8] hover:bg-white/[0.06] hover:text-white' + (side ? ' border border-[#263244]' : '') + glowCls)
      }
    >
      {children}
      {badge > 0 && (
        <span className="zk-badge-pulse pointer-events-none absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[#EF4444] px-1 text-[11px] font-semibold leading-none text-white ring-2 ring-[#111827]">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}

/**
 * Device picker that hangs off the mic / camera caret in the dock.
 */
function LkDockDeviceMenu({ title, devices, current, onPick }) {
  return (
    <div className="py-1.5">
      <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">
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
                    ? 'bg-[#10B981]/15 text-[#34D399]'
                    : 'text-white/90 hover:bg-white/[0.06]')
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

/**
 * Room-context-only side effects. Must live inside <LiveKitRoom> because it
 * uses room/local-participant hooks. Renders nothing.
 */
function RoomEffects() {
  const { localParticipant } = useLocalParticipant()
  const room = useRoomContext()
  const { notify } = useNotifications()

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

  // Participant join/leave toasts — gated on the Settings → Notifications
  // preference (defaults on).
  const joinAlerts = () => {
    try { return localStorage.getItem('zoiko_meet_join_alerts') !== '0' } catch { return true }
  }
  useRoomEvents({
    [RoomEvent.ParticipantConnected]: (p) => {
      if (joinAlerts()) notify('join', { title: 'Joined', text: `${p.name || p.identity} joined the meeting` })
    },
    [RoomEvent.ParticipantDisconnected]: (p) => {
      if (joinAlerts()) notify('leave', { title: 'Left', text: `${p.name || p.identity} left the meeting` })
    },
    // Screen-share is LiveKit-driven (no control-WS event). TrackPublished /
    // TrackUnpublished fire only for REMOTE participants, so the presenter
    // never gets notified about their own share.
    [RoomEvent.TrackPublished]: (pub, p) => {
      if (pub?.source === Track.Source.ScreenShare) {
        notify('screenshare', { title: 'Screen share', text: `${p?.name || p?.identity || 'Someone'} started presenting` })
      }
    },
    [RoomEvent.TrackUnpublished]: (pub, p) => {
      if (pub?.source === Track.Source.ScreenShare) {
        notify('screenshare', { title: 'Screen share', text: `${p?.name || p?.identity || 'Someone'} stopped presenting` })
      }
    },
  })

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

  return null
}

/**
 * Applies the chosen virtual-background effect to the LOCAL camera track via a
 * LiveKit track processor, and reports camera on/off up to the parent so the
 * Backgrounds tab can show the "turn your camera on" hint. Renders nothing.
 * Must live inside <LiveKitRoom> for the LK hooks.
 */
function VirtualBackgroundController({ effect, setLoading, onCameraState }) {
  const { localParticipant } = useLocalParticipant()
  const procRef = useRef(null)

  const camPub = localParticipant?.getTrackPublication?.(Track.Source.Camera)
  const camTrackSid = camPub?.trackSid
  const camOn = !!localParticipant?.isCameraEnabled

  useEffect(() => { onCameraState?.(camOn) }, [camOn, onCameraState])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const lvTrack = localParticipant?.getTrackPublication?.(Track.Source.Camera)?.videoTrack
      // Only attach to a live, published camera. When the camera is off we do
      // nothing; this effect re-runs once it turns on (camOn / sid change).
      if (!lvTrack || !camOn || typeof lvTrack.setProcessor !== 'function') return
      try {
        const none = !effect || effect.type === 'none'
        const current = lvTrack.getProcessor?.()
        if (none) {
          if (current) await lvTrack.stopProcessor()
          procRef.current = null
          return
        }
        setLoading?.(true)
        if (procRef.current && current === procRef.current) {
          // Same processor already on this track — swap the effect in place.
          procRef.current.updateEffect(effect)
        } else {
          const proc = new LkBackgroundProcessor(effect)
          procRef.current = proc
          await lvTrack.setProcessor(proc)
        }
      } catch (e) {
        if (import.meta.env.DEV) console.error('[bg] apply failed', e)
      } finally {
        if (!cancelled) setLoading?.(false)
      }
    })()
    return () => { cancelled = true }
  }, [effect, camOn, camTrackSid, localParticipant, setLoading])

  // Tear down the segmenter when leaving the room.
  useEffect(() => () => { try { procRef.current?.destroy() } catch {} }, [])

  return null
}

function ReconnectToast() {
  const state = useConnectionState()
  if (state !== ConnectionState.Reconnecting) return null
  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-xl bg-[#F59E0B] px-4 py-2 text-sm font-medium text-[#0B1220] shadow-lg">
      <span className="h-2 w-2 animate-pulse rounded-full bg-[#0B1220]/70" />
      Reconnecting to the meeting…
    </div>
  )
}

/** True if a chat body @-mentions the given display name (or @everyone/@here). */
function mentionsMe(body, name) {
  if (!body) return false
  const lower = body.toLowerCase()
  if (lower.includes('@everyone') || lower.includes('@here')) return true
  if (!name) return false
  const first = name.trim().split(/\s+/)[0]?.toLowerCase()
  if (!first) return false
  return lower.includes(`@${first}`) || lower.includes(`@${name.trim().toLowerCase()}`)
}

function Splash({ text, children }) {
  return (
    <div className="grid h-dvh w-screen place-items-center bg-[#0B1220] text-white">
      <div className="flex flex-col items-center text-center">
        <span className="spinner mb-4" />
        <div className="text-[15px] text-[#94A3B8]">{text}</div>
        {children}
      </div>
    </div>
  )
}
