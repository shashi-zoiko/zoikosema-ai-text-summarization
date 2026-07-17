import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { meetingPath } from './lib/meetingUrls.js'
import Layout from './components/Layout.jsx'
import UpdateToast from './components/UpdateToast.jsx'
import CallOverlay from './components/CallOverlay.jsx'
import SemaGuideToggle from './components/SemaGuideToggle.jsx'
import SemaGuidePanel from './features/sema-guide/SemaGuidePanel.jsx'
import Spinner from './components/ui/Spinner.jsx'
import RoomErrorBoundary from './features/meeting/components/RoomErrorBoundary.jsx'
import { useAuth } from './context/AuthContext.jsx'

// Auth pages are tiny and on the critical path for unauthed users — keep eager.
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import Home from './pages/Home.jsx'

// Everything else is route-split so the home-page bundle stays lean.
// MeetRoomLivekit and MeetingIntelligence in particular pull in framer-motion +
// lucide trees that don't need to load until the user actually navigates.
const ForgotPassword = lazy(() => import('./pages/ForgotPassword.jsx'))
const Chat = lazy(() => import('./pages/Chat.jsx'))
const Actions = lazy(() => import('./pages/Actions.jsx'))
const MeetLobby = lazy(() => import('./pages/MeetLobby.jsx'))
const MeetRoomLivekit = lazy(() => import('./features/meeting/MeetRoomLivekit.jsx'))
const MeetingLeft = lazy(() => import('./pages/MeetingLeft.jsx'))
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const ScheduledMeetings = lazy(() => import('./pages/ScheduledMeetings.jsx'))
const MeetingIntelligence = lazy(() => import('./pages/MeetingIntelligence.jsx'))
const OrgSettings = lazy(() => import('./pages/OrgSettings.jsx'))
const AccountSettings = lazy(() => import('./pages/AccountSettings.jsx'))
const CalendarIntegrations = lazy(() => import('./pages/CalendarIntegrations.jsx'))
const CalendarView = lazy(() => import('./pages/CalendarView.jsx'))
const ReviewQueue = lazy(() => import('./pages/ReviewQueue.jsx'))
const Admin = lazy(() => import('./pages/Admin.jsx'))
const Billing = lazy(() => import('./pages/Billing.jsx'))
const HelpSupport = lazy(() => import('./pages/HelpSupport.jsx'))
const ComingSoon = lazy(() => import('./pages/ComingSoon.jsx'))
const Settings = lazy(() => import('./pages/Settings.jsx'))
const SharedRecording = lazy(() => import('./pages/SharedRecording.jsx'))

function PageFallback() {
  return (
    <div className="flex items-center justify-center py-20">
      <Spinner size="lg" />
    </div>
  )
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <div className="spinner" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return children
}

// Admin-only surface (System Administration). Non-admins are bounced home —
// the backend also returns 403, so this is UX, not the security boundary.
function RequireAdmin({ children }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <div className="spinner" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  if (!user.is_admin) return <Navigate to="/" replace />
  return children
}

// Meeting room access: a signed-in user OR an active guest session for THIS
// meeting may enter. Anyone else is bounced to the lobby (/:code), which
// shows the guest-join screen rather than forcing a login.
function RequireMeetingAccess({ children }) {
  const { user, loading, guest } = useAuth()
  const { code } = useParams()
  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <div className="spinner" />
      </div>
    )
  }
  const hasGuestSession = guest && guest.code === code
  if (!user && !hasGuestSession) return <Navigate to={meetingPath(code)} replace />
  return children
}

// Permanent client-side redirect from the legacy /meet/:code… paths to the
// canonical root-level /:code… URLs. Preserves the meeting code, any sub-path
// (e.g. /room-lk, /intelligence), and the query string + hash so deep links,
// old bookmarks, and previously-sent invite emails keep working.
function LegacyMeetRedirect({ suffix = '' }) {
  const { code } = useParams()
  const { search, hash } = useLocation()
  return <Navigate to={`${meetingPath(code)}${suffix}${search}${hash}`} replace />
}

function RedirectIfAuthed({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (user) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <>
    <UpdateToast />
    <CallOverlay />
    <SemaGuidePanel />
    <SemaGuideToggle />
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route
          path="/login"
          element={
            <RedirectIfAuthed>
              <Login />
            </RedirectIfAuthed>
          }
        />
        <Route
          path="/register"
          element={
            <RedirectIfAuthed>
              <Register />
            </RedirectIfAuthed>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <RedirectIfAuthed>
              <ForgotPassword />
            </RedirectIfAuthed>
          }
        />
        {/* Public share playback — no auth so the link works for anyone. */}
        <Route path="/recording/:token" element={<SharedRecording />} />
        {/* Canonical meeting URLs live at the site root: /:code (lobby),
            /:code/room-lk (SFU room), /:code/intelligence (below, auth-gated).
            Meeting codes are generated as xxx-xxxx-xxx (lowercase + hyphens),
            so they can never collide with the static routes (/login, /chat,
            /dashboard, /admin, …); React Router also ranks those static
            routes above the dynamic /:code regardless. */}
        {/* Public lobby: MeetLobby branches internally — signed-in users get
            the existing pre-join flow, anonymous visitors get the guest-join
            screen (no forced login). */}
        <Route path="/:code" element={<MeetLobby />} />
        {/* Post-leave "you left the meeting" screen (Rejoin / Home). Public so
            guests see it too — reached only on a user-initiated leave. */}
        <Route path="/:code/left" element={<MeetingLeft />} />
        {/* LiveKit SFU is the only media plane. /room is kept as an alias for
            old links/bookmarks and the 1:1 call flow; the legacy WebRTC mesh
            room (pages/MeetRoom.jsx) has been removed. Both paths render the
            same LiveKit room. Guests with a valid session for this meeting are
            admitted alongside signed-in users. */}
        <Route
          path="/:code/room"
          element={
            <RequireMeetingAccess>
              <RoomErrorBoundary>
                <MeetRoomLivekit />
              </RoomErrorBoundary>
            </RequireMeetingAccess>
          }
        />
        <Route
          path="/:code/room-lk"
          element={
            <RequireMeetingAccess>
              <RoomErrorBoundary>
                <MeetRoomLivekit />
              </RoomErrorBoundary>
            </RequireMeetingAccess>
          }
        />
        {/* Permanent redirects from the legacy /meet/:code… URLs to canonical
            /:code… — keeps old links, bookmarks, and sent invite emails alive.
            The auth/access checks still run at the canonical destination. */}
        <Route path="/meet/:code" element={<LegacyMeetRedirect />} />
        <Route path="/meet/:code/room" element={<LegacyMeetRedirect suffix="/room" />} />
        <Route path="/meet/:code/room-lk" element={<LegacyMeetRedirect suffix="/room-lk" />} />
        <Route path="/meet/:code/intelligence" element={<LegacyMeetRedirect suffix="/intelligence" />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Home />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/chat/:channelId" element={<Chat />} />
          <Route path="/actions" element={<Actions />} />
          <Route path="/ai-summaries" element={<Dashboard />} />
          <Route path="/scheduled" element={<ScheduledMeetings />} />
          <Route path="/calendar" element={<CalendarView />} />
          <Route path="/calendar/:versionChainId" element={<CalendarView />} />
          <Route path="/:code/intelligence" element={<MeetingIntelligence />} />
          <Route path="/org/:slug" element={<OrgSettings />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/calendar" element={<CalendarIntegrations />} />
          <Route path="/review-queue" element={<ReviewQueue />} />
          <Route path="/security" element={<AccountSettings section="security" />} />
          <Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
          {/* Billing exposes tenant-wide commercial data + destructive controls.
              Admin-only, matching the sidebar's Manage section. Non-admins who
              type the URL are bounced home by RequireAdmin (the backend that
              backs the mutating actions is the real boundary; this is UX). */}
          <Route path="/billing" element={<RequireAdmin><Billing /></RequireAdmin>} />
          <Route path="/recordings" element={<ComingSoon feature="Recordings" description="A searchable archive of your meeting recordings will live here. Recording capture is being finalized." />} />
          <Route path="/analytics" element={<ComingSoon feature="Analytics" description="Usage trends, meeting insights, and workspace reports are on the way." />} />
          <Route path="/help-support" element={<HelpSupport />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
    </>
  )
}
