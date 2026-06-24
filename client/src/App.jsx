import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import UpdateToast from './components/UpdateToast.jsx'
import CallOverlay from './components/CallOverlay.jsx'
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
const Chat = lazy(() => import('./pages/Chat.jsx'))
const Meet = lazy(() => import('./pages/Meet.jsx'))
const MeetLobby = lazy(() => import('./pages/MeetLobby.jsx'))
const MeetRoomLivekit = lazy(() => import('./features/meeting/MeetRoomLivekit.jsx'))
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const MeetingIntelligence = lazy(() => import('./pages/MeetingIntelligence.jsx'))
const OrgSettings = lazy(() => import('./pages/OrgSettings.jsx'))
const Admin = lazy(() => import('./pages/Admin.jsx'))
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
        {/* Public share playback — no auth so the link works for anyone. */}
        <Route path="/recording/:token" element={<SharedRecording />} />
        <Route
          path="/meet/:code"
          element={
            <RequireAuth>
              <MeetLobby />
            </RequireAuth>
          }
        />
        {/* LiveKit SFU is the only media plane. /room is kept as an alias for
            old links/bookmarks and the 1:1 call flow; the legacy WebRTC mesh
            room (pages/MeetRoom.jsx) has been removed. Both paths render the
            same LiveKit room. */}
        <Route
          path="/meet/:code/room"
          element={
            <RequireAuth>
              <RoomErrorBoundary>
                <MeetRoomLivekit />
              </RoomErrorBoundary>
            </RequireAuth>
          }
        />
        <Route
          path="/meet/:code/room-lk"
          element={
            <RequireAuth>
              <RoomErrorBoundary>
                <MeetRoomLivekit />
              </RoomErrorBoundary>
            </RequireAuth>
          }
        />
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
          <Route path="/meet" element={<Meet />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/meet/:code/intelligence" element={<MeetingIntelligence />} />
          <Route path="/org/:slug" element={<OrgSettings />} />
          <Route path="/admin" element={<Admin />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
    </>
  )
}
