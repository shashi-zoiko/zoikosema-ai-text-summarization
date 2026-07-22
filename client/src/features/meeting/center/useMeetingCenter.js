import { useCallback, useEffect, useMemo, useRef } from 'react'
import { resolveTabs, visibleTabs, nearestAvailableTab } from './tabResolver.js'
import { useFlag, isFlagEnabled, FLAGS } from '../../../lib/flags.js'
import { trackEvent, EVENTS } from '../../../lib/analytics.js'

/**
 * Orchestrates the Meeting Center: resolves the tab set from flags + capability
 * + badge context, keeps the active tab valid, and auto-switches to the nearest
 * available tab when permissions/flags change (never rendering inaccessible
 * content). Emits open/tab telemetry.
 *
 * @param {object} args
 * @param {string} args.activeTab            current tab id (from roomStore)
 * @param {(id:string)=>void} args.setActiveTab
 * @param {boolean} args.open                center open state
 * @param {object} args.tabContext           { isHostOrCohost, waitingCount, raisedCount, unreadChat }
 */
export function useMeetingCenter({ activeTab, setActiveTab, open, tabContext }) {
  // useFlag makes the whole resolution reactive to a runtime flag flip (rollback):
  // a live flag reader consulted inside the memo so a toggle re-resolves tabs.
  const peopleFlag = useFlag(FLAGS.PEOPLE_TAB_V3)
  const flagReader = useCallback(
    (f) => (f === FLAGS.PEOPLE_TAB_V3 ? peopleFlag : isFlagEnabled(f)),
    [peopleFlag],
  )

  const resolved = useMemo(
    () => resolveTabs({ ...tabContext, isFlagEnabled: flagReader }),
    [tabContext, flagReader],
  )
  const tabs = useMemo(() => visibleTabs(resolved), [resolved])

  // Keep the active tab valid — auto-switch to nearest available on change.
  useEffect(() => {
    const nearest = nearestAvailableTab(resolved, activeTab)
    if (nearest && nearest !== activeTab) {
      setActiveTab(nearest)
      trackEvent(EVENTS.MEETING_CENTER_TAB_AUTO_SWITCHED, { from: activeTab, to: nearest })
    }
  }, [resolved, activeTab, setActiveTab])

  // Open-latency telemetry: time from open request to this resolve.
  const openStart = useRef(0)
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      openStart.current = perfNow()
      trackEvent(EVENTS.MEETING_CENTER_OPENED, { tab: activeTab, open_ms: 0 })
    } else if (!open && wasOpen.current) {
      trackEvent(EVENTS.MEETING_CENTER_CLOSED, { tab: activeTab })
    }
    wasOpen.current = open
  }, [open, activeTab])

  const selectTab = (id) => {
    if (id === activeTab) return
    trackEvent(EVENTS.MEETING_CENTER_TAB_CHANGED, { from: activeTab, to: id, reason: 'user' })
    setActiveTab(id)
  }

  return { tabs, resolved, activeTab, selectTab }
}

function perfNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
}
