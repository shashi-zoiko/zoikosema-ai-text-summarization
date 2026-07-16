import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Mail } from 'lucide-react'
import { api } from '../api/client'
import { cn } from '../lib/cn'
import MailBodyView from '../components/MailBodyView'

/* Phase 3 slice 4 QA surface — not the real inbox. This exists only so the
 * rendering/sanitization pipeline (GET /mail/messages/{id}/body, nh3 +
 * DOMPurify, image proxy) has somewhere to actually render against synced
 * mail, satisfying the slice's "Done when" acceptance test (spec §19.1).
 * Slice 5 (unified inbox UI + search) replaces this with the real surface —
 * this page should be deleted once slice 5 lands, not extended. */

export default function MailPreview() {
  const navigate = useNavigate()
  const [messages, setMessages] = useState(null) // null = loading
  const [error, setError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    api('/api/connect/mail/messages')
      .then(setMessages)
      .catch((err) => { setError(err.message); setMessages([]) })
  }, [])

  return (
    <div className="mx-auto w-full max-w-[960px] px-6 py-10 sm:px-10">
      <button
        onClick={() => navigate('/settings')}
        className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-[var(--c-fg-muted)] hover:text-[var(--c-fg)]"
      >
        <ChevronLeft className="h-4 w-4" /> Back to settings
      </button>

      <header className="mb-6">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-[var(--c-accent-soft)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--c-accent)]">
          <Mail className="h-3.5 w-3.5" /> Mail (preview)
        </div>
        <h1 className="text-[26px] font-bold tracking-[-0.03em] text-[var(--c-fg)]">Synced messages</h1>
        <p className="mt-1 text-[14px] text-[var(--c-fg-muted)]">
          Internal QA view for the mail rendering pipeline — the real inbox UI is a separate, later slice.
        </p>
      </header>

      {error && (
        <div className="mb-5 rounded-[10px] border border-[color-mix(in_srgb,var(--c-danger)_30%,var(--c-line))] px-4 py-3 text-[13.5px] text-[var(--c-danger)]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-[280px_1fr]">
        <section className="rounded-[14px] border border-[var(--c-line)] bg-[var(--c-bg-1)] p-3 shadow-sm">
          {messages === null && (
            <div className="px-2 py-3 text-[13px] text-[var(--c-fg-muted)]">Loading…</div>
          )}
          {messages?.length === 0 && (
            <div className="px-2 py-3 text-[13px] text-[var(--c-fg-muted)]">No synced messages yet.</div>
          )}
          <div className="space-y-1">
            {messages?.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedId(m.id)}
                className={cn(
                  'block w-full rounded-[8px] px-3 py-2 text-left text-[13px] hover:bg-[var(--c-accent-soft)]',
                  selectedId === m.id && 'bg-[var(--c-accent-soft)]',
                )}
              >
                <span className="block truncate font-medium text-[var(--c-fg)]">{m.subject || '(no subject)'}</span>
                <span className="block truncate text-[12px] text-[var(--c-fg-muted)]">{m.from_email}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-[14px] border border-[var(--c-line)] bg-[var(--c-bg-1)] p-5 shadow-sm">
          {selectedId ? (
            <MailBodyView messageId={selectedId} />
          ) : (
            <div className="text-[13px] text-[var(--c-fg-muted)]">Select a message to render its body.</div>
          )}
        </section>
      </div>
    </div>
  )
}
