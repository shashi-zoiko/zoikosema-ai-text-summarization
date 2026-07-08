import { useNavigate, useParams } from 'react-router-dom'
import { Home, RotateCcw } from 'lucide-react'
import { meetingPath } from '../lib/meetingUrls.js'
import { useAuth } from '../context/AuthContext.jsx'

/**
 * Google-Meet-style post-leave screen. Reached ONLY on a user-initiated leave
 * (see MeetRoomLivekit.userLeave) — never on auth expiry or a server error,
 * which route to the error splash / home instead.
 *
 *   Rejoin      → back to the pre-join lobby, which re-runs the join flow;
 *                 previously-admitted users skip the waiting room (server-side).
 *   Back to Home→ the app dashboard (signed-in users) / lobby (guests).
 */
export default function MeetingLeft() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const rejoin = () => navigate(meetingPath(code))
  const goHome = () => navigate(user ? '/' : meetingPath(code))

  return (
    <div className="grid min-h-dvh w-screen place-items-center bg-[#0B1220] px-5 py-10 text-white">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-2xl bg-[#10B981]/12 text-[#34D399]">
          <RotateCcw className="h-8 w-8" />
        </div>

        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
          You left the meeting
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[#94A3B8]">
          Hope it went well. You can rejoin or head back home.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={rejoin}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#10B981] px-5 py-3 text-[15px] font-semibold text-[#0B1220] transition hover:bg-[#34D399] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]/50"
          >
            <RotateCcw className="h-4 w-4" />
            Rejoin
          </button>
          <button
            type="button"
            onClick={goHome}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#263244] bg-[#111827] px-5 py-3 text-[15px] font-medium text-white/90 transition hover:bg-[#1E293B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#334155]"
          >
            <Home className="h-4 w-4" />
            Back to Home
          </button>
        </div>
      </div>
    </div>
  )
}
