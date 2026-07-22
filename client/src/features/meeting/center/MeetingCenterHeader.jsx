import { Loader2 } from 'lucide-react'

/**
 * Meeting Center title content (rendered inside DrawerShell's title slot).
 * Inline-only (lives inside an <h2>). Shows a subtle recovering indicator while
 * the realtime engine is resyncing after a gap/reconnect.
 */
export default function MeetingCenterHeader({ title = 'In this meeting', recovering = false }) {
  return (
    <>
      <span>{title}</span>
      {recovering && (
        <span className="inline-flex items-center gap-1 text-[11px] font-normal text-[#64748B]" role="status" aria-live="polite">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          Syncing…
        </span>
      )}
    </>
  )
}
