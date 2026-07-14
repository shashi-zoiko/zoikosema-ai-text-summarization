import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Table2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { Card } from './ui/Card'
import { cn } from '../lib/cn'
import { fadeUp } from '../lib/motion'

function SortIcon({ active, dir }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-30" />
  return dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
}

// One sortable table card. Shows an empty state instead of a bare table when
// the AI had nothing grounded in the meeting to put in this table type (e.g.
// a meeting that never touched budget/hours won't fabricate a Resource
// Allocation row) — every table type always renders so users can see at a
// glance what this meeting did and didn't cover.
function SingleTable({ tableData }) {
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  const columns = tableData?.columns || []
  const rows = tableData?.rows || []
  const typeLabel = tableData?.type_label || 'Table'

  const sortedRows = useMemo(() => {
    if (!sortKey || !rows.length) return rows
    return [...rows].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, sortKey, sortDir])

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  return (
    <Card glow className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--c-accent-soft)] text-[var(--c-accent)]">
            <Table2 className="h-4 w-4" />
          </div>
          <h3 className="text-[15px] font-semibold tracking-tight">{typeLabel}</h3>
        </div>
        {rows.length > 0 && (
          <div className="text-[11px] text-[var(--c-fg-muted)]">{rows.length} row{rows.length !== 1 ? 's' : ''}</div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--c-line)] px-4 py-6 text-center text-[12.5px] text-[var(--c-fg-muted)]">
          No {typeLabel.toLowerCase()} data found in this meeting.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--c-line)]">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--c-line)] bg-[var(--c-bg-3)]/60">
                {columns.map((col) => {
                  const active = sortKey === col.key
                  return (
                    <th
                      key={col.key}
                      onClick={() => toggleSort(col.key)}
                      className={cn(
                        'cursor-pointer select-none px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] transition',
                        active ? 'text-[var(--c-accent)]' : 'text-[var(--c-fg-muted)] hover:text-[var(--c-fg-dim)]',
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        {col.label}
                        <SortIcon active={active} dir={active ? sortDir : null} />
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, i) => (
                <motion.tr
                  key={i}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03, duration: 0.2 }}
                  className={cn(
                    'border-b border-[var(--c-line)] transition-colors last:border-b-0',
                    i % 2 === 0 ? 'bg-[var(--c-bg-2)]/20' : 'bg-transparent',
                    'hover:bg-[var(--c-bg-2)]/60',
                  )}
                >
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-2.5 text-[var(--c-fg-dim)]">
                      {row[col.key] ?? '—'}
                    </td>
                  ))}
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

// Renders all 3 AI-generated summary tables (Task Tracker, Resource
// Allocation, Risk Matrix) stacked together, each independently sortable.
export default function TableSummaryView({ tables }) {
  const list = Array.isArray(tables) ? tables : []
  if (!list.length) return null

  return (
    <motion.div variants={fadeUp} initial="initial" animate="animate" className="mb-6 space-y-4">
      {list.map((t, i) => (
        <SingleTable key={t?.type || i} tableData={t} />
      ))}
    </motion.div>
  )
}
