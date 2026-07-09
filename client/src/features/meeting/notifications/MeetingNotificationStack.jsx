import { useMemo, useState } from 'react'
import { buildNotificationInputs, getPanelContent, resolveMeetingNotifications } from './meetingNotificationState.js'
import MeetingBanner from './MeetingBanner.jsx'
import NotificationDetailPanel from './NotificationDetailPanel.jsx'

/**
 * State-aware trust notification stack for the meeting join screen. Reads the
 * meeting's trust state, renders up to 3 banners (policy / confidential /
 * AI+ZoikoTime), and opens a detail drawer per CTA — without interrupting the
 * join flow. All copy + visibility logic lives in meetingNotificationState.
 */
export default function MeetingNotificationStack({ meeting, user }) {
  const [openPanel, setOpenPanel] = useState(null)

  const input = useMemo(() => buildNotificationInputs(meeting, user), [meeting, user])
  const { banners } = useMemo(() => resolveMeetingNotifications(input), [input])
  const panelContent = openPanel ? getPanelContent(openPanel, input) : null

  if (banners.length === 0) return null

  return (
    <>
      <div className="space-y-2.5">
        {banners.map((b) => (
          <MeetingBanner key={b.id} banner={b} onCta={setOpenPanel} />
        ))}
      </div>
      <NotificationDetailPanel content={panelContent} onClose={() => setOpenPanel(null)} />
    </>
  )
}
