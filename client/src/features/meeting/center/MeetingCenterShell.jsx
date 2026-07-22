import { useEffect, useRef } from 'react'
import DrawerShell from '../components/DrawerShell.jsx'
import MeetingCenterHeader from './MeetingCenterHeader.jsx'
import MeetingCenterTabs from './MeetingCenterTabs.jsx'
import MeetingCenterContentHost from './MeetingCenterContentHost.jsx'
import { useMeetingCenter } from './useMeetingCenter.js'
import { usePeopleViewOptional } from '../people/ui/PeopleProvider.jsx'
import { announce } from '../../../lib/announce.js'

/**
 * MeetingCenterShell — the docked/overlay panel that hosts the tabbed Center.
 *
 * Reuses DrawerShell for the responsive chrome (desktop docked panel / mobile
 * full-screen overlay — one shared model) and RoomErrorBoundary (applied by the
 * integration around this shell) so a Center crash never touches the media
 * session or the Leave button.
 *
 * State authority is roomStore (activeTab/open), threaded in as props so the
 * shell stays presentational and the same model serves every surface.
 */
export default function MeetingCenterShell({
  onClose,
  activeTab,
  setActiveTab,
  open = true,
  tabContext,
  renderChat,
}) {
  const { tabs, selectTab } = useMeetingCenter({ activeTab, setActiveTab, open, tabContext })
  const view = usePeopleViewOptional()

  // Announce tab changes for screen readers.
  const prevTab = useRef(activeTab)
  useEffect(() => {
    if (prevTab.current !== activeTab) {
      const label = tabs.find((t) => t.id === activeTab)?.label || activeTab
      announce(`${label} tab`)
      prevTab.current = activeTab
    }
  }, [activeTab, tabs])

  return (
    <DrawerShell
      title={<MeetingCenterHeader recovering={!!view?.recovering} />}
      onClose={onClose}
      bodyClassName="!overflow-hidden flex min-h-0 flex-col p-0"
      subheader={<MeetingCenterTabs tabs={tabs} activeTab={activeTab} onSelect={selectTab} />}
    >
      <MeetingCenterContentHost activeTab={activeTab} renderChat={renderChat} />
    </DrawerShell>
  )
}
