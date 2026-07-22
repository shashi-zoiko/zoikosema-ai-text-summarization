import { useMemo, useRef } from 'react'
import { Users } from 'lucide-react'
import { usePeopleApi, usePeopleView } from './PeopleProvider.jsx'
import ParticipantRow, { ROW_H } from './ParticipantRow.jsx'
import { useVirtualRows } from '../../../../hooks/useVirtualRows.js'
import { GROUP } from '../constants.js'
import { userIdToIdentity } from '../identity.js'

const GROUP_LABEL = {
  [GROUP.WAITING]: 'Waiting',
  [GROUP.HOSTS]: 'Hosts',
  [GROUP.COHOSTS]: 'Co-hosts',
  [GROUP.PRESENTERS]: 'Presenters',
  [GROUP.EXTERNAL_GUESTS]: 'External guests',
  [GROUP.PARTICIPANTS]: 'Participants',
  [GROUP.VIEW_ONLY]: 'View only',
  [GROUP.MEETING_SERVICES]: 'Meeting services',
}

function AdmitAllButton() {
  const api = usePeopleApi()
  const { view } = usePeopleView()
  const [act] = api.queueActions(view.waitingCount)
  if (!act?.available) return null
  return (
    <button
      type="button"
      onClick={() => api.actions.admitAll()}
      className="rounded-full border-0 bg-[#10B981] px-3 py-1 text-[12px] font-semibold text-[#04140D] shadow-none hover:bg-[#0EA972]"
    >
      Admit all
    </button>
  )
}

function GroupHeader({ group, count, sticky }) {
  return (
    <div
      role="presentation"
      style={{ height: sticky ? undefined : ROW_H }}
      className={
        'z-10 flex items-center justify-between bg-[#0B1220]/95 px-3 text-[12px] font-semibold uppercase tracking-wide text-[#64748B] backdrop-blur ' +
        (sticky ? 'sticky top-0 py-2' : 'flex')
      }
    >
      <span>{GROUP_LABEL[group] || group} · {count}</span>
      {group === GROUP.WAITING && <AdmitAllButton />}
    </div>
  )
}

function rowProps(person, api) {
  const identity = userIdToIdentity(person.userId)
  const pinned = api.pinnedKey != null && (String(api.pinnedKey) === String(person.key) || api.pinnedKey === identity)
  const speaking = api.speakingKeys ? api.speakingKeys.has?.(person.key) : false
  return { person, pinned, speaking }
}

export default function PeopleList() {
  const api = usePeopleApi()
  const { view, virtualize, rowCount } = usePeopleView()
  const { groups } = view
  const scrollRef = useRef(null)

  // Flatten to a uniform-height entry list for the virtualized path.
  const entries = useMemo(() => {
    const out = []
    for (const g of groups) {
      out.push({ type: 'header', group: g.id, count: g.people.length })
      for (const p of g.people) out.push({ type: 'row', person: p, group: g.id })
    }
    return out
  }, [groups])

  const win = useVirtualRows({ scrollRef, count: entries.length, rowH: ROW_H, enabled: virtualize })

  if (groups.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center text-[#64748B]">
        <Users className="h-8 w-8" aria-hidden="true" />
        <p className="text-[13px]">No one matches</p>
      </div>
    )
  }

  // Non-virtualized: native sticky group headers, all rows mounted (<= threshold).
  if (!virtualize) {
    return (
      <div ref={scrollRef} className="zk-filmstrip min-h-0 flex-1 overflow-y-auto" role="list" aria-label={`Participants, ${view.total}`}>
        {groups.map((g) => (
          <section key={g.id} aria-label={`${GROUP_LABEL[g.id] || g.id}, ${g.people.length}`}>
            <GroupHeader group={g.id} count={g.people.length} sticky />
            <ul role="list" className="m-0 list-none p-0">
              {g.people.map((p) => <ParticipantRow key={p.key} {...rowProps(p, api)} />)}
            </ul>
          </section>
        ))}
      </div>
    )
  }

  // Virtualized: windowed flat entries + a persistent current-group bar.
  const windowEntries = entries.slice(win.start, win.end)
  const currentGroup = entries[win.start]?.group ?? groups[0]?.id
  const currentCount = groups.find((g) => g.id === currentGroup)?.people.length ?? 0

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <GroupHeader group={currentGroup} count={currentCount} sticky />
      <div
        ref={scrollRef}
        role="list"
        aria-label={`Participants, ${view.total}. Showing ${rowCount} rows, virtualized.`}
        className="zk-filmstrip min-h-0 flex-1 overflow-y-auto"
      >
        <div style={{ height: win.padTop }} aria-hidden="true" />
        {windowEntries.map((e, i) =>
          e.type === 'header'
            ? <GroupHeader key={`h:${e.group}:${win.start + i}`} group={e.group} count={e.count} />
            : <ul key={e.person.key} role="list" className="m-0 list-none p-0"><ParticipantRow {...rowProps(e.person, api)} /></ul>,
        )}
        <div style={{ height: win.padBottom }} aria-hidden="true" />
      </div>
    </div>
  )
}
