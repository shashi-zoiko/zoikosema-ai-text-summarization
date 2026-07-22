import { Suspense, lazy } from 'react'
import { Loader2 } from 'lucide-react'
import RoomErrorBoundary from '../components/RoomErrorBoundary.jsx'
import { TAB } from './tabRegistry.js'

/**
 * Renders the active tab's content in a role="tabpanel", lazy-loading module tabs
 * and isolating each with its own RoomErrorBoundary. A tab module that throws
 * shows a scoped fallback — the Meeting Center header/tabs, the media session and
 * the Leave button are untouched (media-isolation contract).
 *
 * People is a lazy module (self-contained via PeopleProvider context). Chat is
 * rendered through an injected slot that reuses the existing ChatPanel — the
 * Center hosts chat rather than duplicating it.
 */
const LazyPeopleTab = lazy(() => import('../people/ui/PeopleTab.jsx'))

function TabLoading() {
  return (
    <div className="flex flex-1 items-center justify-center py-16 text-[#64748B]" role="status" aria-live="polite">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  )
}

function TabError({ reset }) {
  return (
    <div className="m-3 rounded-xl border border-[#263244] bg-[#0B1220] p-4 text-center">
      <p className="text-[13px] text-white">This panel hit a problem.</p>
      <p className="mt-1 text-[12px] text-[#64748B]">Your meeting is still connected.</p>
      <button
        type="button" onClick={reset}
        className="mt-3 rounded-lg border-0 bg-[#10B981] px-3 py-1.5 text-[12px] font-semibold text-[#04140D]"
      >
        Reload panel
      </button>
    </div>
  )
}

export default function MeetingCenterContentHost({ activeTab, renderChat }) {
  let content
  if (activeTab === TAB.PEOPLE) {
    content = <Suspense fallback={<TabLoading />}><LazyPeopleTab /></Suspense>
  } else if (activeTab === TAB.CHAT) {
    content = renderChat ? renderChat() : <TabError reset={() => {}} />
  } else {
    content = null
  }

  return (
    <div
      role="tabpanel"
      id={`zk-center-panel-${activeTab}`}
      aria-labelledby={`zk-center-tab-${activeTab}`}
      tabIndex={0}
      className="flex min-h-0 flex-1 flex-col focus:outline-none"
    >
      <RoomErrorBoundary fallback={({ reset }) => <TabError reset={reset} />}>
        {content}
      </RoomErrorBoundary>
    </div>
  )
}
