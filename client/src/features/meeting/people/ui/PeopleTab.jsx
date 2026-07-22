import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import PeopleToolbar from './PeopleToolbar.jsx'
import PeopleList from './PeopleList.jsx'
import { usePeopleView } from './PeopleProvider.jsx'
import { announce } from '../../../../lib/announce.js'
import { trackEvent, EVENTS } from '../../../../lib/analytics.js'

/**
 * People tab content — toolbar (search + filters) over the grouped, virtualized
 * roster. Lazy default export (loaded by the content host). Assumes a
 * PeopleProvider ancestor supplies the domain model.
 */
export default function PeopleTab() {
  const { ready, view, recovering } = usePeopleView()

  // Mount telemetry (privacy-safe: count only).
  const mountedRef = useRef(false)
  useEffect(() => {
    if (mountedRef.current) return
    mountedRef.current = true
    trackEvent(EVENTS.PEOPLE_MOUNTED, { count: view.total })
  }, [view.total])

  // Announce waiting-queue changes for screen readers.
  const prevWaiting = useRef(view.waitingCount)
  useEffect(() => {
    if (view.waitingCount > prevWaiting.current) {
      const n = view.waitingCount
      announce(`${n} ${n === 1 ? 'person' : 'people'} waiting to join`, { assertive: false })
    }
    prevWaiting.current = view.waitingCount
  }, [view.waitingCount])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PeopleToolbar />
      {recovering && (
        <div className="flex items-center gap-2 bg-[#10B981]/10 px-3 py-1.5 text-[12px] text-[#34D399]" role="status" aria-live="polite">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Reconnecting the participant list…
        </div>
      )}
      {!ready && view.total === 0 ? (
        <div className="flex flex-1 items-center justify-center py-16 text-[#64748B]" role="status" aria-live="polite">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading participants…</span>
        </div>
      ) : (
        <PeopleList />
      )}
    </div>
  )
}
