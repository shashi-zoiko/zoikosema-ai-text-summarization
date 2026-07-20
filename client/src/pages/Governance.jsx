import { useEffect, useState } from 'react'
import { ChevronLeft, History, Lock, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { Card } from '../components/ui/Card'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Spinner from '../components/ui/Spinner'
import { Field } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'

/* Real Policy Engine admin surface (spec §14 Calendar/Mail Admin — category
 * autonomy ceiling; §4.1 effective-autonomy resolution; §14 Settings
 * History — as-of/diff/export). Distinct from Settings.jsx's "Agentic
 * Governance" cards, which are a pre-existing mock-data scaffold unrelated
 * to this backend (see /api/settings/overview) — this page is the first
 * real wiring of GET/POST /api/connect/policy/*, not a rewrite of that one.
 *
 * Every L2 (Action Review staging), L3 (mail send/delayed-buffer), and L4
 * feature built this build is INERT until an admin raises a tenant's
 * ceiling here — Policy Engine's own conservative default is L1, so this
 * page is what actually turns those features on. */

const LEVEL_LABELS = {
  0: 'L0 — Observe', 1: 'L1 — Suggest', 2: 'L2 — Prepare',
  3: 'L3 — Execute (review window)', 4: 'L4 — Autonomous within bounds',
}
const CATEGORIES = [
  { key: 'calendar', label: 'Calendar' },
  { key: 'mail', label: 'Mail' },
]

function CategoryPanel({ category, label }) {
  const { toast } = useToast()
  const [resolved, setResolved] = useState(null)
  const [history, setHistory] = useState(null)
  const [nextCeiling, setNextCeiling] = useState('')
  const [diffRef, setDiffRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = async () => {
    try {
      const [r, h] = await Promise.all([
        api(`/api/connect/policy/${category}/resolve`),
        api(`/api/connect/policy/${category}/history`),
      ])
      setResolved(r)
      setHistory(h)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const currentCeiling = history?.[0]?.autonomy_ceiling ?? 1

  const submit = async () => {
    const level = parseInt(nextCeiling, 10)
    if (Number.isNaN(level) || level < 0 || level > 4) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/connect/policy/ceiling', {
        method: 'POST', body: { category, autonomy_ceiling: level, diff_ref: diffRef.trim() || undefined },
      })
      toast(`${label} autonomy ceiling set to L${level}`)
      setNextCeiling('')
      setDiffRef('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-[var(--c-line)] p-5">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-semibold tracking-tight text-[var(--c-fg)]">{label}</h3>
            {!!history?.length && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[var(--c-bg-3)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--c-fg-dim)]">
                <Lock className="h-3 w-3" /> Managed by Zoiko Group
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12.5px] text-[var(--c-fg-muted)]">
            Current ceiling: <Badge tone="accent" size="sm">{LEVEL_LABELS[currentCeiling] || currentCeiling}</Badge>
          </p>
        </div>
        {resolved && (
          <div className="text-right">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--c-fg-muted)]">Effective now</div>
            <div className="text-[15px] font-bold text-[var(--c-fg)]">{LEVEL_LABELS[resolved.effective_level] || resolved.effective_level}</div>
          </div>
        )}
      </div>

      <div className="space-y-4 border-b border-[var(--c-line)] p-5">
        {resolved && (
          <div>
            <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--c-fg-muted)]">Resolved inputs (spec §4.1)</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(resolved.inputs).map(([k, v]) => (
                <Badge key={k} tone={v === resolved.effective_level ? 'warn' : 'neutral'} size="sm">{k}: L{v}</Badge>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-end gap-2">
          <Field label="Set new ceiling" hint="0-4">
            <input
              type="number" min={0} max={4} value={nextCeiling} onChange={(e) => setNextCeiling(e.target.value)}
              className="h-11 w-24 rounded-xl border border-[var(--c-line-strong)] bg-[var(--c-bg-1)] px-3 text-[14px] text-[var(--c-fg)] outline-none focus:border-[var(--c-accent)]"
            />
          </Field>
          <Field label="Reason (optional)">
            <input
              value={diffRef} onChange={(e) => setDiffRef(e.target.value)} placeholder="Why this change?"
              className="h-11 w-full rounded-xl border border-[var(--c-line-strong)] bg-[var(--c-bg-1)] px-3.5 text-[14px] text-[var(--c-fg)] outline-none focus:border-[var(--c-accent)]"
            />
          </Field>
          <Button variant="primary" size="sm" disabled={busy || nextCeiling === ''} onClick={submit}>
            {busy ? 'Saving…' : 'Update'}
          </Button>
        </div>
        {error && <p className="text-[12.5px] text-[var(--c-danger)]">{error}</p>}
      </div>

      <div className="p-5">
        <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--c-fg-muted)]">
          <History className="h-3 w-3" /> Version history
        </div>
        {history === null && <p className="text-[12.5px] text-[var(--c-fg-muted)]">Loading…</p>}
        {history?.length === 0 && <p className="text-[12.5px] text-[var(--c-fg-muted)]">No changes yet — tenant default (L1) is in effect.</p>}
        <div className="space-y-1.5">
          {history?.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--c-line)] px-3 py-2 text-[12.5px]">
              <span>
                v{v.version} — {LEVEL_LABELS[v.autonomy_ceiling] || v.autonomy_ceiling}
                {v.diff_ref && <span className="text-[var(--c-fg-muted)]"> ({v.diff_ref})</span>}
              </span>
              <span className="text-[11px] text-[var(--c-fg-muted)]">{new Date(v.effective_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

function MailGovernanceSettingsPanel() {
  const { toast } = useToast()
  const [current, setCurrent] = useState(undefined) // undefined = loading, null = never set
  const [history, setHistory] = useState(null)
  const [keywordsText, setKeywordsText] = useState('')
  const [minMinutes, setMinMinutes] = useState('')
  const [maxMinutes, setMaxMinutes] = useState('')
  const [defaultMinutes, setDefaultMinutes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = async () => {
    try {
      const [c, h] = await Promise.all([
        api('/api/connect/policy/mail-governance-settings'),
        api('/api/connect/policy/mail-governance-settings/history'),
      ])
      setCurrent(c)
      setHistory(h)
      if (c) {
        setKeywordsText(c.sensitive_keywords.join(', '))
        setMinMinutes(String(c.buffer_min_minutes))
        setMaxMinutes(String(c.buffer_max_minutes))
        setDefaultMinutes(String(c.buffer_default_minutes))
      }
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { load() }, [])

  const submit = async () => {
    const min = parseInt(minMinutes, 10)
    const max = parseInt(maxMinutes, 10)
    const def = parseInt(defaultMinutes, 10)
    if ([min, max, def].some((n) => Number.isNaN(n))) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/connect/policy/mail-governance-settings', {
        method: 'POST',
        body: {
          sensitive_keywords: keywordsText.split(',').map((k) => k.trim()).filter(Boolean),
          buffer_min_minutes: min, buffer_max_minutes: max, buffer_default_minutes: def,
        },
      })
      toast('Mail governance settings updated')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-[var(--c-line)] p-5">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-semibold tracking-tight text-[var(--c-fg)]">Mail settings</h3>
            {!!current && (
              <span className="inline-flex items-center gap-1 rounded-md bg-[var(--c-bg-3)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--c-fg-dim)]">
                <Lock className="h-3 w-3" /> Managed by Zoiko Group
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12.5px] text-[var(--c-fg-muted)]">
            DLP sensitive-keyword list and the delayed-send buffer's allowed range (spec §5.3, §10.2).
            {current === null && ' Not yet configured — every tenant shares the built-in defaults until set here.'}
          </p>
        </div>
      </div>

      <div className="space-y-4 border-b border-[var(--c-line)] p-5">
        <Field label="Sensitive keywords" hint="Comma-separated. Matched case-insensitively against outbound mail body text.">
          <input
            value={keywordsText} onChange={(e) => setKeywordsText(e.target.value)}
            placeholder="do not forward, internal only"
            className="h-11 w-full rounded-xl border border-[var(--c-line-strong)] bg-[var(--c-bg-1)] px-3.5 text-[14px] text-[var(--c-fg)] outline-none focus:border-[var(--c-accent)]"
          />
        </Field>
        <div className="flex items-end gap-2">
          <Field label="Min buffer (min)" hint="0-1440">
            <input
              type="number" min={0} max={1440} value={minMinutes} onChange={(e) => setMinMinutes(e.target.value)}
              className="h-11 w-28 rounded-xl border border-[var(--c-line-strong)] bg-[var(--c-bg-1)] px-3 text-[14px] text-[var(--c-fg)] outline-none focus:border-[var(--c-accent)]"
            />
          </Field>
          <Field label="Default buffer (min)">
            <input
              type="number" min={0} max={1440} value={defaultMinutes} onChange={(e) => setDefaultMinutes(e.target.value)}
              className="h-11 w-28 rounded-xl border border-[var(--c-line-strong)] bg-[var(--c-bg-1)] px-3 text-[14px] text-[var(--c-fg)] outline-none focus:border-[var(--c-accent)]"
            />
          </Field>
          <Field label="Max buffer (min)">
            <input
              type="number" min={0} max={1440} value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)}
              className="h-11 w-28 rounded-xl border border-[var(--c-line-strong)] bg-[var(--c-bg-1)] px-3 text-[14px] text-[var(--c-fg)] outline-none focus:border-[var(--c-accent)]"
            />
          </Field>
          <Button variant="primary" size="sm" disabled={busy || current === undefined} onClick={submit}>
            {busy ? 'Saving…' : 'Update'}
          </Button>
        </div>
        {error && <p className="text-[12.5px] text-[var(--c-danger)]">{error}</p>}
      </div>

      <div className="p-5">
        <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--c-fg-muted)]">
          <History className="h-3 w-3" /> Version history
        </div>
        {history === null && <p className="text-[12.5px] text-[var(--c-fg-muted)]">Loading…</p>}
        {history?.length === 0 && <p className="text-[12.5px] text-[var(--c-fg-muted)]">No changes yet — built-in defaults are in effect.</p>}
        <div className="space-y-1.5">
          {history?.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--c-line)] px-3 py-2 text-[12.5px]">
              <span>
                v{v.version} — buffer {v.buffer_min_minutes}-{v.buffer_max_minutes}m (default {v.buffer_default_minutes}m), {v.sensitive_keywords.length} keyword(s)
                {v.diff_ref && <span className="text-[var(--c-fg-muted)]"> ({v.diff_ref})</span>}
              </span>
              <span className="text-[11px] text-[var(--c-fg-muted)]">{new Date(v.effective_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

export default function Governance() {
  const navigate = useNavigate()

  return (
    <div className="mx-auto w-full max-w-[900px] px-6 py-10 sm:px-10">
      <button
        onClick={() => navigate('/settings')}
        className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-[var(--c-fg-muted)] hover:text-[var(--c-fg)]"
      >
        <ChevronLeft className="h-4 w-4" /> Back to settings
      </button>

      <header className="mb-6">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-[var(--c-accent-soft)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--c-accent)]">
          <ShieldCheck className="h-3.5 w-3.5" /> Governance
        </div>
        <h1 className="text-[26px] font-bold tracking-[-0.03em] text-[var(--c-fg)]">Autonomy ceilings</h1>
        <p className="mt-1 text-[14px] text-[var(--c-fg-muted)]">
          Controls what Sema's agents may do on their own vs. stage for review. Raising a ceiling above L1 is what
          turns on Action Review staging (L2), delayed-send (L3), and any bounded autonomy (L4) for that category —
          nothing here executes until an admin explicitly opts in.
        </p>
      </header>

      <div className="space-y-5">
        {CATEGORIES.map((c) => <CategoryPanel key={c.key} category={c.key} label={c.label} />)}
        <MailGovernanceSettingsPanel />
      </div>
    </div>
  )
}
