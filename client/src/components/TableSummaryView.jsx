import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Table2 } from 'lucide-react'
import { motion } from 'framer-motion'
import Badge from './ui/Badge'
import { Card } from './ui/Card'
import { cn } from '../lib/cn'
import { fadeUp } from '../lib/motion'

function SortIcon({ active, dir }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-30" />
  return dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
}

export default function TableSummaryView({ tableData }) {
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  const columns = tableData?.columns || []
  const rows = tableData?.rows || []
  const typeLabel = tableData?.type_label || 'Table'

  const sortedRows = useMemo(() => {
    const r = tableData?.rows || []
    if (!sortKey || !r.length) return r
    return [...r].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [tableData, sortKey, sortDir])

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  if (!rows.length) return null

  return (
    <motion.div variants={fadeUp} initial="initial" animate="animate">
      <Card glow className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--c-accent-soft)] text-[var(--c-accent)]">
              <Table2 className="h-4 w-4" />
            </div>
            <h3 className="text-[15px] font-semibold tracking-tight">Summary Table</h3>
            {typeLabel && <Badge tone="accent" size="sm">{typeLabel}</Badge>}
          </div>
          <div className="text-[11px] text-[var(--c-fg-muted)]">{rows.length} row{rows.length !== 1 ? 's' : ''}</div>
        </div>

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
      </Card>
    </motion.div>
  )
}
