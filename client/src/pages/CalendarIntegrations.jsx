import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Calendar, Check, ChevronLeft, Plug, Trash2, UserPlus, Users } from 'lucide-react'
import { api } from '../api/client'
import { cn } from '../lib/cn'
import Modal from '../components/ui/Modal'
import { Field, Input } from '../components/ui/Input'
import Button from '../components/ui/Button'
import { useToast } from '../components/ui/Toast'

const DELEGABLE_PROVIDERS = new Set(['gmail', 'microsoft_mail'])

/* Admin-consent / OAuth connect UI (Phase 1 slice 6). Real backend only —
 * GET/POST/DELETE /api/connect/provider-connections, same endpoints slices
 * 1-5 already exercise. Connecting is a full browser navigation (not a
 * fetch): the user has to actually see and approve the Google/Microsoft
 * consent screen, then the backend redirects back here with ?connected=... /
 * ?error=... so this page can refresh state and show the result. */

const PROVIDERS = [
  { key: 'google_calendar', label: 'Google Calendar' },
  // Outlook/Microsoft 365 Calendar hidden from UI — costly to run; native Sema calendar is the direction.
  // Backend/adapters kept intact, not deleted. Re-add the entry below to re-enable.
  { key: 'microsoft_calendar', label: 'Outlook / Microsoft 365 Calendar', hidden: true },
  { key: 'gmail', label: 'Gmail' },
  { key: 'microsoft_mail', label: 'Outlook Mail' },
]

const ERROR_MESSAGES = {
  access_denied: 'You declined the consent screen — nothing was connected.',
  missing_code_or_state: 'The provider redirect was incomplete. Please try again.',
  invalid_argument: 'That connection request expired or was invalid. Please try again.',
  internal_error: 'Something went wrong finishing that connection. Please try again.',
}

/* Phase 4 slice 1 — shared mailbox delegated access. A connected Gmail/
 * Outlook Mail account can be delegated to teammates (spec §10.1); this
 * modal is the grant/revoke UI over
 * /api/connect/shared-mailboxes/delegates. Delegate lookup reuses the
 * admin panel's existing user search (/api/admin/users?search=) rather
 * than building a second one — same reasoning as everywhere else in this
 * build ("check for something to extend before adding something new").
 * Known, disclosed gap: that search endpoint is workspace-admin-only, so a
 * mailbox owner who ISN'T an admin can still grant/revoke (the backend
 * only requires owner-or-admin) but can't search by name/email here —
 * searchFailed surfaces that plainly instead of a silent empty list. */
function DelegateManagerModal({ connection, label, open, onClose }) {
  const { toast } = useToast()
  const [delegates, setDelegates] = useState(null)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState([])
  const [searchFailed, setSearchFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = () => {
    api(`/api/connect/shared-mailboxes/delegates?provider_connection_id=${encodeURIComponent(connection.id)}`)
      .then(setDelegates)
      .catch((err) => { setError(err.message); setDelegates([]) })
  }

  useEffect(() => { if (open) load() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!query.trim()) { setMatches([]); setSearchFailed(false); return }
    const handle = setTimeout(() => {
      api(`/api/admin/users?search=${encodeURIComponent(query.trim())}&limit=5`)
        .then((r) => { setMatches(r); setSearchFailed(false) })
        .catch(() => { setMatches([]); setSearchFailed(true) })
    }, 300)
    return () => clearTimeout(handle)
  }, [query])

  const grant = async (delegateUserId) => {
    setBusy(true)
    setError(null)
    try {
      await api('/api/connect/shared-mailboxes/delegates', {
        method: 'POST', body: { provider_connection_id: connection.id, delegate_user_id: delegateUserId },
      })
      toast('Delegate access granted')
      setQuery('')
      setMatches([])
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (delegateId) => {
    setBusy(true)
    setError(null)
    try {
      await api(`/api/connect/shared-mailboxes/delegates/${encodeURIComponent(delegateId)}/revoke`, { method: 'POST' })
      toast('Delegate access revoked')
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Delegates — ${label}`} description={connection.provider_account_email} size="md">
      <div className="space-y-4">
        <Field label="Grant access to" hint="Search by name or email">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="teammate@example.com" />
        </Field>
        {searchFailed && (
          <p className="text-[12px] text-[var(--c-fg-muted)]">
            User search requires a workspace admin — ask an admin to grant access if you're the mailbox owner but not an admin.
          </p>
        )}
        {matches.length > 0 && (
          <div className="space-y-1.5 rounded-[10px] border border-[var(--c-line)] bg-[var(--c-bg-2)] p-2">
            {matches.map((u) => (
              <button
                key={u.id}
                disabled={busy}
                onClick={() => grant(u.id)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--c-accent-soft)]"
              >
                <span className="truncate">{u.name} <span className="text-[var(--c-fg-muted)]">({u.email})</span></span>
                <UserPlus className="h-3.5 w-3.5 shrink-0 text-[var(--c-accent)]" />
              </button>
            ))}
          </div>
        )}
        {error && <p className="text-[12.5px] text-[var(--c-danger)]">{error}</p>}

        <div>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--c-fg-muted)]">Current delegates</div>
          {delegates === null && <p className="text-[12.5px] text-[var(--c-fg-muted)]">Loading…</p>}
          {delegates?.length === 0 && <p className="text-[12.5px] text-[var(--c-fg-muted)]">No one has delegated access yet.</p>}
          <div className="space-y-1.5">
            {delegates?.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--c-line)] px-3 py-2 text-[13px]">
                <span>User #{d.delegate_user_id} — <span className={d.status === 'active' ? 'text-[var(--c-success)]' : 'text-[var(--c-fg-muted)]'}>{d.status}</span></span>
                {d.status === 'active' && (
                  <Button variant="ghost" size="xs" disabled={busy} onClick={() => revoke(d.id)}>Revoke</Button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default function CalendarIntegrations() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [connections, setConnections] = useState(null) // null = loading
  const [busyProvider, setBusyProvider] = useState(null)
  const [banner, setBanner] = useState(null) // { ok, text }
  const [delegateModalFor, setDelegateModalFor] = useState(null) // provider key

  const load = async () => {
    try {
      const list = await api('/api/connect/provider-connections')
      setConnections(list)
    } catch (err) {
      setBanner({ ok: false, text: err.message })
      setConnections([])
    }
  }

  useEffect(() => {
    const connected = searchParams.get('connected')
    const error = searchParams.get('error')
    if (connected) setBanner({ ok: true, text: `Connected ${labelFor(connected)}.` })
    else if (error) setBanner({ ok: false, text: ERROR_MESSAGES[error] || 'That connection attempt failed.' })
    if (connected || error) setSearchParams({}, { replace: true })
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const labelFor = (key) => PROVIDERS.find((p) => p.key === key)?.label || key

  const byProvider = (key) => connections?.find((c) => c.provider === key && c.status === 'active')

  const connect = async (providerKey) => {
    setBusyProvider(providerKey)
    setBanner(null)
    try {
      const { authorization_url } = await api(
        `/api/connect/provider-connections/authorize?provider=${encodeURIComponent(providerKey)}`,
      )
      // Full navigation, not fetch — the consent screen must render for the user.
      window.location.href = authorization_url
    } catch (err) {
      setBanner({ ok: false, text: err.message })
      setBusyProvider(null)
    }
  }

  const disconnect = async (providerKey) => {
    if (!window.confirm(`Disconnect ${labelFor(providerKey)}? Synced events stop refreshing until you reconnect.`)) return
    setBusyProvider(providerKey)
    try {
      await api(`/api/connect/provider-connections/${encodeURIComponent(providerKey)}`, { method: 'DELETE' })
      setBanner({ ok: true, text: `Disconnected ${labelFor(providerKey)}.` })
      await load()
    } catch (err) {
      setBanner({ ok: false, text: err.message })
    } finally {
      setBusyProvider(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[820px] px-6 py-10 sm:px-10">
      <button
        onClick={() => navigate('/settings')}
        className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-[var(--c-fg-muted)] hover:text-[var(--c-fg)]"
      >
        <ChevronLeft className="h-4 w-4" /> Back to settings
      </button>

      <header className="mb-6">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-[var(--c-accent-soft)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--c-accent)]">
          <Calendar className="h-3.5 w-3.5" /> Calendar
        </div>
        <h1 className="text-[26px] font-bold tracking-[-0.03em] text-[var(--c-fg)]">Connected calendars</h1>
        <p className="mt-1 text-[14px] text-[var(--c-fg-muted)]">
          Connect Google so Sema can read your availability and show scheduling suggestions.
        </p>
      </header>

      {banner && (
        <div
          className={cn(
            'mb-5 flex items-start gap-2.5 rounded-[10px] border px-4 py-3 text-[13.5px]',
            banner.ok
              ? 'border-[color-mix(in_srgb,var(--c-accent)_25%,var(--c-line))] bg-[var(--c-accent-soft)] text-[var(--c-fg)]'
              : 'border-[color-mix(in_srgb,var(--c-danger)_30%,var(--c-line))] bg-[var(--c-danger-soft,transparent)] text-[var(--c-danger)]',
          )}
        >
          {banner.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{banner.text}</span>
        </div>
      )}

      <section className="rounded-[14px] border border-[var(--c-line)] bg-[var(--c-bg-1)] p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex items-start gap-2">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-[var(--c-fg)]">Providers</h2>
            <p className="mt-0.5 text-[13px] text-[var(--c-fg-muted)]">Read-only — Sema never writes events back to a connected provider.</p>
          </div>
        </div>

        <div className="space-y-2.5">
          {connections === null && (
            <div className="rounded-[10px] border border-[var(--c-line-strong)] bg-[var(--c-bg-1)] px-3.5 py-3 text-[13px] text-[var(--c-fg-muted)]">
              Loading…
            </div>
          )}
          {connections !== null &&
            PROVIDERS.filter((p) => !p.hidden).map((p) => {
              const conn = byProvider(p.key)
              const busy = busyProvider === p.key
              return (
                <div
                  key={p.key}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[var(--c-line-strong)] bg-[var(--c-bg-1)] px-3.5 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--c-accent-soft)] text-[var(--c-accent)]">
                      <Plug className="h-4.5 w-4.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-semibold text-[var(--c-fg)]">{p.label}</span>
                      <span className="block truncate text-[12px] text-[var(--c-fg-muted)]">
                        {conn ? conn.provider_account_email : 'Not connected'}
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {conn && DELEGABLE_PROVIDERS.has(p.key) && (
                      <button
                        onClick={() => setDelegateModalFor(p.key)}
                        className="inline-flex items-center gap-1.5 !rounded-[9px] !border-[var(--c-line-strong)] !bg-[var(--c-bg-1)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--c-fg-dim)] hover:text-[var(--c-fg)]"
                      >
                        <Users className="h-3.5 w-3.5" /> Delegates
                      </button>
                    )}
                    {conn ? (
                      <button
                        disabled={busy}
                        onClick={() => disconnect(p.key)}
                        className="inline-flex items-center gap-1.5 !rounded-[9px] !border-[color-mix(in_srgb,var(--c-danger)_35%,transparent)] !bg-[var(--c-bg-1)] px-3 py-1.5 text-[12.5px] font-medium !text-[var(--c-danger)] disabled:opacity-60"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> {busy ? 'Disconnecting…' : 'Disconnect'}
                      </button>
                    ) : (
                      <button
                        disabled={busy}
                        onClick={() => connect(p.key)}
                        className="primary !rounded-[9px] !px-3 !py-1.5 !text-[12.5px]"
                      >
                        {busy ? 'Redirecting…' : `Connect ${p.label}`}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
        </div>
      </section>

      {delegateModalFor && (
        <DelegateManagerModal
          connection={byProvider(delegateModalFor)}
          label={PROVIDERS.find((p) => p.key === delegateModalFor)?.label}
          open
          onClose={() => setDelegateModalFor(null)}
        />
      )}
    </div>
  )
}
