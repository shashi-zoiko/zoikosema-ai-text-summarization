import { Search, X } from 'lucide-react'
import { usePeopleApi, usePeopleView } from './PeopleProvider.jsx'
import { FILTER } from '../constants.js'

/**
 * People search + filter bar. Search is debounced in the provider (150ms, spec
 * 120–180ms); filters apply immediately. Both are persisted in roomStore so they
 * survive tab switches. Filters use aria-pressed toggle chips.
 */
const FILTER_LABELS = [
  [FILTER.WAITING, 'Waiting'],
  [FILTER.HOSTS, 'Hosts'],
  [FILTER.PRESENTERS, 'Presenters'],
  [FILTER.EXTERNAL, 'External'],
  [FILTER.RAISED_HANDS, 'Raised hands'],
  [FILTER.MUTED, 'Muted'],
  [FILTER.CAMERA_OFF, 'Camera off'],
  [FILTER.SHARING, 'Sharing'],
  [FILTER.CONNECTION_ATTENTION, 'Connection'],
]

export default function PeopleToolbar() {
  const { setSearch, toggleFilter } = usePeopleApi()
  const { search, filters, view } = usePeopleView()

  return (
    <div className="flex flex-col gap-2 border-b border-[#263244] px-3 pb-2 pt-1">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" aria-hidden="true" />
        <input
          type="search"
          role="searchbox"
          aria-label="Search participants"
          value={search}
          onChange={(e) => setSearch?.(e.target.value)}
          placeholder="Search people"
          className="h-9 w-full rounded-lg border border-[#263244] bg-[#0B1220] pl-9 pr-8 text-[14px] text-white placeholder:text-[#64748B] focus:border-[#10B981] focus:outline-none focus:ring-1 focus:ring-[#10B981]"
        />
        {search && (
          <button
            type="button" onClick={() => setSearch?.('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full !bg-transparent !border-0 !p-0 !shadow-none text-[#64748B] hover:text-white"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter participants">
        {FILTER_LABELS.map(([id, label]) => {
          const active = filters.includes(id)
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => toggleFilter?.(id)}
              className={
                'rounded-full border px-2.5 py-1 text-[12px] font-medium transition ' +
                (active
                  ? 'border-[#10B981] bg-[#10B981]/15 text-[#34D399]'
                  : 'border-[#263244] bg-transparent text-[#94A3B8] hover:border-[#3A4A61] hover:text-white')
              }
            >
              {label}
            </button>
          )
        })}
      </div>

      {(search || filters.length > 0) && (
        <p className="px-0.5 text-[12px] text-[#64748B]" role="status" aria-live="polite">
          {view.matched} of {view.total} shown
        </p>
      )}
    </div>
  )
}
