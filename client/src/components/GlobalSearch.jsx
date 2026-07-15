import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Calendar, Loader2, MessageSquareText, Search, Video } from 'lucide-react'
import { api } from '../api/client'
import { meetingPath } from '../lib/meetingUrls.js'
import { cn } from '../lib/cn'

/* ─────────────────────────────────────────────────────────────────────────
 * GlobalSearch — the header search box, now wired to real data instead of the
 * decorative input it replaced. On first focus it lazily pulls the caller's
 * meetings (recent + scheduled) and chat channels, then filters them locally
 * as the user types. Results are grouped, keyboard-navigable (↑/↓/Enter/Esc),
 * and open the relevant page. ⌘K / Ctrl-K focuses it from anywhere.
 *
 * No mock data: everything shown comes from endpoints the user can already
 * see. A code-shaped query also surfaces a direct "Join meeting" action.
 * ──────────────────────────────────────────────────────────────────────── */

// Meeting codes look like xxx-xxxx-xxx (lowercase + hyphens).
const CODE_RE = /^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/i

export default function GlobalSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [meetings, setMeetings] = useState([])
  const [channels, setChannels] = useState([])
  const [active, setActive] = useState(0)

  const inputRef = useRef(null)
  const rootRef = useRef(null)

  // Lazily load the searchable corpus the first time the box is focused, so the
  // header stays cheap for users who never search.
  const ensureLoaded = async () => {
    if (loaded || loading) return
    setLoading(true)
    try {
      const [recent, scheduled, chans] = await Promise.all([
        api('/api/meetings/recent').catch(() => []),
        api('/api/meetings/scheduled').catch(() => []),
        api('/api/channels').catch(() => []),
      ])
      // De-dupe meetings by code (recent + scheduled overlap).
      const byCode = {}
      for (const m of [...(recent || []), ...(scheduled || [])]) {
        if (m?.code && !byCode[m.code]) byCode[m.code] = m
      }
      setMeetings(Object.values(byCode))
      setChannels(Array.isArray(chans) ? chans : [])
      setLoaded(true)
    } finally {
      setLoading(false)
    }
  }

  // ⌘K / Ctrl-K focuses the box from anywhere.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const out = []

    if (CODE_RE.test(q)) {
      out.push({ type: 'join', id: `join:${q}`, label: `Join meeting ${q}`, code: q })
    }

    for (const m of meetings) {
      const title = (m.title || 'Untitled meeting').toLowerCase()
      const code = (m.code || '').toLowerCase()
      if (title.includes(q) || code.includes(q)) {
        out.push({
          type: m.scheduled_at ? 'scheduled' : 'meeting',
          id: `m:${m.code}`,
          label: m.title || 'Untitled meeting',
          sub: m.code,
          code: m.code,
        })
      }
      if (out.length >= 20) break
    }

    for (const c of channels) {
      if ((c.name || '').toLowerCase().includes(q)) {
        out.push({
          type: 'chat',
          id: `c:${c.id}`,
          label: c.name || 'Conversation',
          sub: c.is_direct ? 'Direct message' : 'Channel',
          channelId: c.id,
        })
      }
      if (out.length >= 20) break
    }

    return out.slice(0, 20)
  }, [query, meetings, channels])

  // Keep the active index in range as results change.
  useEffect(() => { setActive(0) }, [query])

  const go = (r) => {
    if (!r) return
    if (r.type === 'chat') navigate(`/chat/${r.channelId}`)
    else navigate(meetingPath(r.code))
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); return }
    if (!results.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % results.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + results.length) % results.length) }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[active]) }
  }

  const showDropdown = open && query.trim().length > 0

  return (
    <div ref={rootRef} className="relative min-w-0 max-w-[560px] flex-1">
      <label className="flex h-11 min-w-0 items-center gap-2.5 rounded-xl border border-[var(--c-line)] bg-[var(--c-surface)] px-3.5 text-[var(--c-fg-muted)] transition focus-within:border-[var(--c-accent)] focus-within:shadow-[0_0_0_4px_var(--c-accent-ring)]">
        {loading ? <Loader2 className="h-[18px] w-[18px] shrink-0 animate-spin" /> : <Search className="h-[18px] w-[18px] shrink-0" />}
        <input
          ref={inputRef}
          type="search"
          value={query}
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="global-search-results"
          placeholder="Search meetings, chats or codes…"
          onFocus={() => { setOpen(true); ensureLoaded() }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 border-0 bg-transparent text-[13.5px] text-[var(--c-fg)] outline-none placeholder:text-[var(--c-fg-muted)]"
        />
        <kbd className="hidden shrink-0 items-center gap-0.5 rounded-md border border-[var(--c-line-strong)] bg-[var(--c-bg-2)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--c-fg-muted)] sm:inline-flex">
          ⌘ K
        </kbd>
      </label>

      {showDropdown && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[420px] overflow-y-auto rounded-xl border border-[var(--c-line-strong)] bg-[var(--c-surface)] p-1.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.45)]"
        >
          {results.length === 0 ? (
            <div className="px-3 py-6 text-center text-[13px] text-[var(--c-fg-muted)]">
              {loading ? 'Searching…' : loaded ? `No matches for “${query.trim()}”` : 'Type to search your meetings and chats'}
            </div>
          ) : (
            results.map((r, i) => (
              <ResultRow
                key={r.id}
                result={r}
                active={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r)}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

const ICONS = {
  meeting: Video,
  scheduled: Calendar,
  chat: MessageSquareText,
  join: Video,
}

function ResultRow({ result, active, onMouseEnter, onClick }) {
  const Icon = ICONS[result.type] || Search
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
        active ? 'bg-[var(--c-bg-3)]' : 'hover:bg-[var(--c-bg-3)]'
      )}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--c-accent-soft)] text-[var(--c-accent)] [&_svg]:h-[16px] [&_svg]:w-[16px]">
        <Icon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-[var(--c-fg)]">{result.label}</span>
        {result.sub && <span className="block truncate text-[11.5px] text-[var(--c-fg-muted)]">{result.sub}</span>}
      </span>
    </button>
  )
}
