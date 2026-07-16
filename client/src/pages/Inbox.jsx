import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Mail, RefreshCw, Search, X } from 'lucide-react'
import { api } from '../api/client'
import { cn } from '../lib/cn'
import MailBodyView from '../components/MailBodyView'
import MailMessageActions from '../components/MailMessageActions'
import Spinner from '../components/ui/Spinner'
import Button from '../components/ui/Button'
import { useToast } from '../components/ui/Toast'

/* Phase 3 slice 5 — Unified Inbox UI + read-only search. Replaces the
 * slice 4 QA surface (MailPreview.jsx, now deleted) as the real mail
 * surface: list + reading pane across every connected Gmail/Outlook
 * account, backed by GET /mail/messages and GET /mail/search. The reading
 * pane's action bar (draft reply, summarize, convert to task/meeting) is
 * slice 8/10's real surface — MailMessageActions.jsx, not built here. */

const SYNCABLE_PROVIDERS = [
  { key: 'gmail', label: 'Gmail' },
  { key: 'microsoft_mail', label: 'Outlook Mail' },
]

export default function Inbox() {
  const { toast } = useToast()
  const [messages, setMessages] = useState(null) // null = loading
  const [error, setError] = useState(null)
  const [selectedMessage, setSelectedMessage] = useState(null)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [connections, setConnections] = useState([])
  const [syncingProvider, setSyncingProvider] = useState(null)

  const loadMessages = useCallback(() => {
    setError(null)
    api('/api/connect/mail/messages')
      .then(setMessages)
      .catch((err) => { setError(err.message); setMessages([]) })
  }, [])

  useEffect(() => {
    loadMessages()
    api('/api/connect/provider-connections')
      .then((list) => setConnections(list.filter((c) => c.status === 'active')))
      .catch(() => { /* sync buttons just won't show if this fails */ })
  }, [loadMessages])

  useEffect(() => {
    if (!query.trim()) {
      setSearching(false)
      loadMessages()
      return
    }
    setSearching(true)
    const handle = setTimeout(() => {
      api(`/api/connect/mail/search?q=${encodeURIComponent(query.trim())}`)
        .then(setMessages)
        .catch((err) => { setError(err.message); setMessages([]) })
    }, 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const connectedProviders = SYNCABLE_PROVIDERS.filter((p) => connections.some((c) => c.provider === p.key))

  const syncProvider = async (providerKey, label) => {
    setSyncingProvider(providerKey)
    try {
      const result = await api('/api/connect/mail/sync', { method: 'POST', body: { provider: providerKey } })
      toast(`${label} synced — ${result.created} new, ${result.updated} updated`)
      loadMessages()
    } catch (err) {
      toast(err.message)
    } finally {
      setSyncingProvider(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-10 sm:px-10">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-[var(--c-accent-soft)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--c-accent)]">
            <Mail className="h-3.5 w-3.5" /> Mail
          </div>
          <h1 className="text-[26px] font-bold tracking-[-0.03em] text-[var(--c-fg)]">Inbox</h1>
          <p className="mt-1 text-[14px] text-[var(--c-fg-muted)]">
            Unified view across every connected Gmail/Outlook account.
          </p>
        </div>
        {connectedProviders.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {connectedProviders.map((p) => (
              <Button
                key={p.key}
                variant="outline"
                size="sm"
                disabled={syncingProvider === p.key}
                leftIcon={<RefreshCw className={cn('h-3.5 w-3.5', syncingProvider === p.key && 'animate-spin')} />}
                onClick={() => syncProvider(p.key, p.label)}
              >
                Sync {p.label}
              </Button>
            ))}
          </div>
        )}
      </header>

      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--c-fg-muted)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search subject, sender, or snippet…"
          className="w-full rounded-[10px] border border-[var(--c-line-strong)] bg-[var(--c-bg-1)] py-2.5 pl-10 pr-9 text-[13.5px] text-[var(--c-fg)] outline-none placeholder:text-[var(--c-fg-muted)] focus-visible:border-[var(--c-accent)]"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--c-fg-muted)] hover:text-[var(--c-fg)]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {error && (
        <div className="mb-5 flex items-center gap-2 rounded-[10px] border border-[color-mix(in_srgb,var(--c-danger)_30%,var(--c-line))] px-4 py-3 text-[13.5px] text-[var(--c-danger)]">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {connections.length === 0 && messages !== null && messages.length === 0 && (
        <div className="mb-5 rounded-[14px] border border-dashed border-[var(--c-line-strong)] bg-[var(--c-bg-2)] px-6 py-10 text-center">
          <Mail className="mx-auto mb-3 h-8 w-8 text-[var(--c-fg-muted)]" />
          <p className="text-[13.5px] font-medium text-[var(--c-fg)]">No mail connected yet</p>
          <p className="mt-1 text-[12.5px] text-[var(--c-fg-muted)]">
            Connect Gmail or Outlook Mail from Settings to see your inbox here.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-[320px_1fr]">
        <section className="rounded-[14px] border border-[var(--c-line)] bg-[var(--c-bg-1)] p-3 shadow-sm">
          {(messages === null || searching) && messages === null && (
            <div className="flex items-center justify-center py-10"><Spinner size="md" /></div>
          )}
          {messages !== null && messages.length === 0 && (
            <div className="px-2 py-3 text-[13px] text-[var(--c-fg-muted)]">
              {query.trim() ? 'No matching messages.' : 'No synced messages yet.'}
            </div>
          )}
          <div className="max-h-[70vh] space-y-1 overflow-y-auto">
            {(messages || []).map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedMessage(m)}
                className={cn(
                  'block w-full rounded-[8px] px-3 py-2.5 text-left text-[13px] hover:bg-[var(--c-accent-soft)]',
                  selectedMessage?.id === m.id && 'bg-[var(--c-accent-soft)]',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-[var(--c-fg)]">{m.subject || '(no subject)'}</span>
                  <span className="shrink-0 text-[11px] text-[var(--c-fg-muted)]">{formatDate(m.received_at)}</span>
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-[var(--c-fg-muted)]">{m.from_email}</span>
                {m.snippet && <span className="mt-0.5 block truncate text-[11.5px] text-[var(--c-fg-muted)]">{m.snippet}</span>}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-[14px] border border-[var(--c-line)] bg-[var(--c-bg-1)] p-5 shadow-sm">
          {selectedMessage ? (
            <>
              <MailBodyView messageId={selectedMessage.id} />
              <MailMessageActions message={selectedMessage} />
            </>
          ) : (
            <div className="flex h-full min-h-[200px] items-center justify-center text-[13px] text-[var(--c-fg-muted)]">
              Select a message to read it.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
