import { createContext, useContext, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, ArrowUpRight, Bell, Building2, Check, ChevronRight, Crown,
  Download, FileText, Lock, Plug, RotateCcw, Save, Search, Settings2, Shield,
  ShieldCheck, Sparkles, Upload, User, Video, X, Zap,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme, THEMES } from '../theme/ThemeProvider'
import { useToast } from '../components/ui/Toast'
import { Card } from '../components/ui/Card'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import Avatar from '../components/ui/Avatar'
import Spinner from '../components/ui/Spinner'
import { cn } from '../lib/cn'
import { useResource } from '../lib/useResource'
import { can, money, normalizeRole, recordAudit } from '../features/settings/settingsData'

/* All page content is fetched from /api/settings/overview and shared via this
 * context so nested cards read it without prop-threading. */
const SettingsDataContext = createContext(null)
const useData = () => useContext(SettingsDataContext)

const SECTION_ICONS = { User, Video, Sparkles, Bell, ShieldCheck, Plug, Settings2 }
const POLICY_ICONS = { Lock, Building2, User, Crown, Shield }

const TONE_TEXT = {
  success: 'text-[var(--c-success)]', accent: 'text-[var(--c-accent)]',
  warn: 'text-[var(--c-warn)]', danger: 'text-[var(--c-danger)]', neutral: 'text-[var(--c-fg-dim)]',
}
const TONE_SOFT = {
  success: 'bg-[var(--c-success-soft)] text-[var(--c-success)]',
  accent: 'bg-[var(--c-accent-soft)] text-[var(--c-accent)]',
  warn: 'bg-[var(--c-warn-soft)] text-[var(--c-warn)]',
  danger: 'bg-[var(--c-danger-soft)] text-[var(--c-danger)]',
  neutral: 'bg-[var(--c-bg-3)] text-[var(--c-fg-dim)]',
}

/* ══════════════════════════════ reusable primitives ══════════════════════════════ */

export function SettingsCard({ title, description, icon: Icon, actions, children, className, id }) {
  return (
    <Card className={className} id={id}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--c-line)] p-5 pb-4">
          <div className="flex min-w-0 items-start gap-3">
            {Icon && (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--c-accent-soft)] text-[var(--c-accent)] [&_svg]:h-[18px] [&_svg]:w-[18px]"><Icon /></span>
            )}
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold tracking-tight text-[var(--c-fg)]">{title}</h3>
              {description && <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--c-fg-muted)]">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </Card>
  )
}

function SectionLabel({ children, className }) {
  return <div className={cn('mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--c-fg-muted)]', className)}>{children}</div>
}

/* PolicyBadge (= PolicyLockBadge). Renders the scope + policy state and, when
 * relevant, an inline action (Request Exception / Override). */
export function PolicyBadge({ state, act, label, compact }) {
  const { POLICY } = useData()
  const p = POLICY[state]
  if (!p) return null
  const Icon = POLICY_ICONS[p.icon] || User
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium', TONE_SOFT[p.tone], 'border-[color-mix(in_srgb,currentColor_25%,transparent)]')}
        title={p.label}
      >
        <Icon className="h-3 w-3" />
        {compact ? p.scope : p.label}
      </span>
      {p.action && act && (
        <button
          onClick={() => act(`${p.action} — ${label}`, p.action === 'Request Exception' ? 'requestException' : 'editWorkspace')}
          className="text-[10.5px] font-semibold text-[var(--c-accent)] hover:underline"
        >
          {p.action}
        </button>
      )}
    </span>
  )
}

/* SettingToggle — respects policy state to pick the save behavior. */
export function SettingToggle({ label, hint, value, state = 'user_preference', act, sectionLabel }) {
  const { POLICY } = useData()
  const p = POLICY[state]
  const [on, setOn] = useState(!!value)
  const locked = p.readOnly

  const toggle = () => {
    if (locked) return
    const next = !on
    if (p.compliance) { act.compliance(sectionLabel, label, next ? 'On' : 'Off', () => setOn(next)); return }
    setOn(next)
    if (state === 'workspace_inherited') act.markDirty(`${sectionLabel}:${label}`, next ? 'On' : 'Off')
    else act.autosave(sectionLabel, label, next ? 'On' : 'Off')
  }

  return (
    <div className={cn('flex items-center justify-between gap-3 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] px-3.5 py-3', locked && 'opacity-90')}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] font-medium text-[var(--c-fg)]">{label}</span>
          <PolicyBadge state={state} act={act} label={label} compact />
        </div>
        {hint && <p className="mt-0.5 text-[11.5px] text-[var(--c-fg-muted)]">{hint}</p>}
      </div>
      <button
        type="button" role="switch" aria-checked={on} aria-label={label} disabled={locked}
        onClick={toggle}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent-ring)]',
          on ? 'bg-[var(--c-accent)]' : 'bg-[var(--c-line-strong)]', locked && 'cursor-not-allowed',
        )}
      >
        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', on ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </button>
    </div>
  )
}

function SettingSelect({ label, value, options, state = 'user_preference', act, sectionLabel }) {
  const { POLICY } = useData()
  const p = POLICY[state]
  const [val, setVal] = useState(value)
  const locked = p.readOnly

  const onChange = (e) => {
    const next = e.target.value
    setVal(next)
    if (p.compliance) { act.compliance(sectionLabel, label, next, () => {}); return }
    if (state === 'workspace_inherited') act.markDirty(`${sectionLabel}:${label}`, next)
    else act.autosave(sectionLabel, label, next)
  }

  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] px-3.5 py-2.5">
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium text-[var(--c-fg)]">{label}</span>
        <PolicyBadge state={state} act={act} label={label} compact />
      </span>
      <select
        value={val} disabled={locked} onChange={onChange} aria-label={label}
        className="max-w-[52%] shrink-0 rounded-lg border border-[var(--c-line)] bg-[var(--c-surface)] px-2.5 py-1.5 text-[13px] font-medium text-[var(--c-fg)] outline-none focus:border-[var(--c-accent)] disabled:cursor-not-allowed disabled:opacity-70"
      >
        {options.map((o) => <option key={o} value={o} className="bg-[var(--c-surface)]">{o}</option>)}
      </select>
    </label>
  )
}

/* Renders any {type} setting row from the data model. */
function SettingRow({ s, act, sectionLabel }) {
  if (s.type === 'toggle') return <SettingToggle label={s.label} value={s.value} state={s.state} act={act} sectionLabel={sectionLabel} />
  return <SettingSelect label={s.label} value={s.value} options={s.options} state={s.state} act={act} sectionLabel={sectionLabel} />
}

function EnterpriseGate({ title }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-[var(--c-line-strong)] bg-[var(--c-bg-2)] px-4 py-3 opacity-90">
      <Crown className="h-4 w-4 shrink-0 text-[var(--c-warn)]" />
      <span className="text-[12.5px] text-[var(--c-fg-muted)]">{title} — <span className="font-medium text-[var(--c-fg-dim)]">Available on Sema Enterprise</span></span>
    </div>
  )
}

/* ══════════════════════════════ Section 1 · Account ══════════════════════════════ */

function AccountSection({ act }) {
  const { ACCOUNT } = useData()
  const { user, updateProfile, uploadAvatar, removeAvatar } = useAuth()
  const { theme, setTheme } = useTheme()
  const [name, setName] = useState(user?.name || '')
  const [jobTitle, setJobTitle] = useState(user?.job_title || '')
  const [pronouns, setPronouns] = useState(user?.pronouns || '')
  const [saving, setSaving] = useState(false)
  const fileRef = useRef(null)

  const dirty = !!name.trim() && (name.trim() !== user?.name || jobTitle !== (user?.job_title || '') || pronouns !== (user?.pronouns || ''))

  const saveProfile = async () => {
    if (!dirty) return
    setSaving(true)
    try {
      await updateProfile({ name: name.trim(), job_title: jobTitle.trim(), pronouns: pronouns.trim() })
      act.toast('Profile updated')
    } catch (e) { act.error(e.message) } finally { setSaving(false) }
  }
  const onPhoto = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    try { await uploadAvatar(f); act.toast('Photo updated') } catch (err) { act.error(err.message) }
  }

  return (
    <div className="space-y-4">
      <SettingsCard title="Profile" description="Your identity across the workspace. Some fields are managed by your admin." icon={User}>
        <div className="mb-5 flex items-center gap-4">
          <Avatar name={user?.name} color={user?.avatar_color} src={user?.avatar_url} size="lg" presence="online" />
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onPhoto} />
            <Button variant="outline" size="sm" leftIcon={<Upload className="h-3.5 w-3.5" />} onClick={() => fileRef.current?.click()}>{user?.avatar_url ? 'Change photo' : 'Upload photo'}</Button>
            {user?.avatar_url && <Button variant="ghost" size="sm" onClick={() => removeAvatar().then(() => act.toast('Photo removed'))}>Remove</Button>}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Name" value={name} onChange={setName} />
          <TextField label="Job title" value={jobTitle} onChange={setJobTitle} placeholder="e.g. Product Designer" />
          <TextField label="Pronouns" value={pronouns} onChange={setPronouns} placeholder="e.g. she/her" />
          <LockedField label="Email" value={user?.email} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SectionLabel className="mb-0 mr-1">Admin-managed</SectionLabel>
          {ACCOUNT.lockedFields.map((f) => (
            <span key={f} className="inline-flex items-center gap-1 rounded-full bg-[var(--c-bg-3)] px-2 py-0.5 text-[11px] text-[var(--c-fg-muted)]"><Lock className="h-3 w-3" />{f}</span>
          ))}
        </div>
        <div className="mt-4 border-t border-[var(--c-line)] pt-3">
          <Button variant="primary" size="sm" leftIcon={<Save className="h-4 w-4" />} disabled={!dirty || saving} onClick={saveProfile}>{saving ? 'Saving…' : 'Save profile'}</Button>
        </div>
      </SettingsCard>

      <SettingsCard title="Language & Region" description="How dates, languages, and AI output are localized." icon={FileText}>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {ACCOUNT.languageRegion.map((s) => <SettingSelect key={s.key} label={s.label} value={s.value} options={s.options} state={s.state} act={act} sectionLabel="Language & Region" />)}
        </div>
      </SettingsCard>

      <SettingsCard title="Appearance" description="Theme for this device. Autosaves." icon={Sparkles}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {THEMES.map((t) => {
            const active = t.id === theme
            return (
              <button key={t.id} onClick={() => { setTheme(t.id); act.toast(`Theme: ${t.label}`) }}
                className={cn('flex items-center gap-2.5 rounded-xl border px-3 py-3 text-left text-[13px] font-medium transition-colors',
                  active ? 'border-[var(--c-accent)] bg-[var(--c-accent-soft)] text-[var(--c-fg)]' : 'border-[var(--c-line-strong)] bg-[var(--c-bg-2)] text-[var(--c-fg-dim)] hover:bg-[var(--c-bg-3)]')}>
                <Sparkles className="h-4 w-4 shrink-0 text-[var(--c-accent)]" /><span className="truncate">{t.label}</span>
                {active && <Check className="ml-auto h-4 w-4 shrink-0 text-[var(--c-accent)]" />}
              </button>
            )
          })}
        </div>
      </SettingsCard>

      <SettingsCard title="Sessions & Providers" description="Active devices and connected identity providers." icon={ShieldCheck}
        actions={<Button variant="outline" size="xs" onClick={() => act('Sign out everywhere', 'editUserPref')}>Sign out everywhere</Button>}>
        <SectionLabel>Active devices</SectionLabel>
        <ul className="space-y-2">
          {ACCOUNT.sessions.map((d) => (
            <li key={d.device} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] px-3.5 py-2.5">
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-[13px] font-medium text-[var(--c-fg)]">{d.device}{d.current && <Badge tone="success" size="sm">This device</Badge>}</span>
                <span className="text-[11.5px] text-[var(--c-fg-muted)]">{d.location} · {d.lastActive}</span>
              </span>
              {!d.current && <Button variant="ghost" size="xs" onClick={() => act(`Sign out ${d.device}`, 'editUserPref')}>Sign out</Button>}
            </li>
          ))}
        </ul>
        <SectionLabel className="mt-4">Connected providers</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {ACCOUNT.providers.map((p) => <Badge key={p.name} tone={p.connected ? 'accent' : 'neutral'} size="md">{p.name}{p.connected ? ' · Connected' : ''}</Badge>)}
        </div>
        <dl className="mt-4 grid gap-x-8 border-t border-[var(--c-line)] pt-3 sm:grid-cols-2">
          <KV label="Data residency" value={ACCOUNT.dataResidency} />
          <KV label="Regulatory jurisdiction" value={ACCOUNT.regulatoryJurisdiction} />
        </dl>
      </SettingsCard>
    </div>
  )
}

function TextField({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-[var(--c-fg-dim)]">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-lg border border-[var(--c-line-strong)] bg-[var(--c-surface)] px-3 py-2 text-[13.5px] text-[var(--c-fg)] outline-none focus:border-[var(--c-accent)] focus:ring-2 focus:ring-[var(--c-accent-ring)]" />
    </label>
  )
}
function LockedField({ label, value }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-[12px] font-medium text-[var(--c-fg-dim)]">{label} <Lock className="h-3 w-3 text-[var(--c-fg-muted)]" /></span>
      <input value={value || ''} readOnly className="w-full cursor-not-allowed rounded-lg border border-[var(--c-line)] bg-[var(--c-bg-3)] px-3 py-2 text-[13.5px] text-[var(--c-fg-muted)] outline-none" />
    </label>
  )
}
function KV({ label, value, strong }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-[12.5px] text-[var(--c-fg-muted)]">{label}</dt>
      <dd className={cn('min-w-0 truncate text-right text-[13px] text-[var(--c-fg)]', strong && 'font-semibold')}>{value}</dd>
    </div>
  )
}

/* ══════════════════════════════ Section 2 · Meetings ══════════════════════════════ */

function MeetingsSection({ act }) {
  const { MEETINGS } = useData()
  return (
    <div className="space-y-4">
      <SettingsCard title="Join Defaults" icon={Video}>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {MEETINGS.joinDefaults.map((s) => <SettingRow key={s.key} s={s} act={act} sectionLabel="Join Defaults" />)}
        </div>
      </SettingsCard>
      <div className="grid gap-4 lg:grid-cols-2">
        <SettingsCard title="Appearance" icon={Sparkles}>
          <div className="space-y-2.5">{MEETINGS.appearance.map((s) => <SettingRow key={s.key} s={s} act={act} sectionLabel="Appearance" />)}</div>
        </SettingsCard>
        <SettingsCard title="Meeting Behavior" icon={Settings2}>
          <div className="space-y-2.5">{MEETINGS.behavior.map((s) => <SettingRow key={s.key} s={s} act={act} sectionLabel="Meeting Behavior" />)}</div>
        </SettingsCard>
      </div>
      <SettingsCard title="Captions" icon={FileText}>
        <div className="grid gap-2.5 sm:grid-cols-2">{MEETINGS.captions.map((s) => <SettingRow key={s.key} s={s} act={act} sectionLabel="Captions" />)}</div>
      </SettingsCard>
      <SettingsCard title="Confidential Mode compatibility" description="Conflicts are shown explicitly — never silently ignored." icon={Shield}>
        <ul className="space-y-2">
          {MEETINGS.confidentialConflicts.map((c) => (
            <li key={c.setting} className="flex items-start gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--c-warn)_25%,var(--c-line))] bg-[var(--c-warn-soft)] px-3.5 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--c-warn)]" />
              <span className="text-[12.5px] text-[var(--c-fg-dim)]"><span className="font-semibold text-[var(--c-fg)]">{c.setting}:</span> {c.conflict}</span>
            </li>
          ))}
        </ul>
      </SettingsCard>
    </div>
  )
}

/* ══════════════════════════════ Section 3 · AI & Agentic ══════════════════════════════ */

function AISection({ act }) {
  const { AUTONOMY_LEVELS, CURRENT_AUTONOMY, ROLLBACK_RULES, REASONING_TRACE } = useData()
  const [level, setLevel] = useState(CURRENT_AUTONOMY)
  return (
    <div className="space-y-4">
      <SettingsCard title="Agentic Governance" description="The default autonomy your AI operates under. Higher levels require caps and audit." icon={Sparkles}
        actions={<PolicyBadge state="workspace_inherited" act={act} label="Autonomy level" compact />}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {AUTONOMY_LEVELS.map((l) => <AgenticLevelCard key={l.level} l={l} active={l.level === level} onSelect={() => { setLevel(l.level); act.markDirty('AI & Agentic:Autonomy level', `Level ${l.level}`) }} />)}
        </div>
      </SettingsCard>

      <SettingsCard title="Category Governance" description="Per-category autonomy, spend caps, and rollback authority." icon={Shield}
        actions={<>
          <Button variant="outline" size="xs" disabled={!can(act.role, 'editGovernance')} onClick={() => act('Edit governance', 'editGovernance')}>Edit Governance</Button>
          <Button variant="ghost" size="xs" onClick={() => act('Export policy')}>Export Policy</Button>
          <Button variant="ghost" size="xs" onClick={() => act('View action log')}>View Action Log</Button>
        </>}>
        <CategoryGovernanceTable act={act} />
      </SettingsCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SettingsCard title="Rollback Authority" description="What can be undone, and how." icon={RotateCcw}>
          <ul className="space-y-2">
            {ROLLBACK_RULES.map((r) => (
              <li key={r.kind} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] px-3.5 py-2.5">
                <span className="text-[13px] font-medium text-[var(--c-fg)]">{r.kind}</span>
                <span className={cn('text-[12.5px] font-medium', TONE_TEXT[r.tone])}>{r.rule}</span>
              </li>
            ))}
          </ul>
        </SettingsCard>

        <SettingsCard title="Agentic Reasoning Traces" description="Retention & access for AI decision traces." icon={FileText}
          actions={<PolicyBadge state={REASONING_TRACE.state} act={act} label="Reasoning traces" compact />}>
          <dl>
            <KV label="Retention" value={REASONING_TRACE.retention} strong />
            <KV label="Storage" value={REASONING_TRACE.storage} />
          </dl>
          <SectionLabel className="mt-3">Access</SectionLabel>
          <div className="flex flex-wrap gap-2">{REASONING_TRACE.access.map((a) => <Badge key={a} tone="neutral" size="md">{a}</Badge>)}</div>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--c-line)] pt-3">
            <Button variant="outline" size="xs" onClick={() => act.compliance('AI & Agentic', 'Trace retention', 'reconfigure', () => {})}>Configure Retention</Button>
            <Button variant="ghost" size="xs" onClick={() => act('SIEM export', 'viewAudit')}>SIEM Export</Button>
            <Button variant="ghost" size="xs" onClick={() => act('View trace policy')}>View Trace Policy</Button>
          </div>
        </SettingsCard>
      </div>

      <SpendControl act={act} />
    </div>
  )
}

export function AgenticLevelCard({ l, active, onSelect }) {
  return (
    <button onClick={onSelect} aria-pressed={active}
      className={cn('flex flex-col rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent-ring)]',
        active ? 'border-[var(--c-accent)] bg-[var(--c-accent-soft)]' : 'border-[var(--c-line)] bg-[var(--c-bg-2)] hover:bg-[var(--c-bg-3)]')}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--c-surface)] text-[12px] font-bold text-[var(--c-fg)]">{l.level}</span>
        <Badge tone={l.tone} size="sm">{active ? 'Current' : `Level ${l.level}`}</Badge>
      </div>
      <div className="mt-2 text-[13.5px] font-semibold text-[var(--c-fg)]">{l.name}</div>
      <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--c-fg-muted)]">{l.desc}</p>
    </button>
  )
}

const LVL_TONE = { 0: 'neutral', 1: 'accent', 2: 'accent', 3: 'warn', 4: 'danger' }
function CategoryGovernanceTable({ act }) {
  const { CATEGORY_GOVERNANCE } = useData()
  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-[var(--c-line)] text-[11px] uppercase tracking-wide text-[var(--c-fg-muted)]">
              {['Category', 'Autonomy Level', 'Spend Cap', 'Rollback Authority', 'Policy'].map((h) => <th key={h} scope="col" className="py-2 pr-4 font-semibold">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {CATEGORY_GOVERNANCE.map((r) => (
              <tr key={r.category} className="border-b border-[var(--c-line)] last:border-0">
                <td className="py-2.5 pr-4 font-medium">{r.category}</td>
                <td className="py-2.5 pr-4">{r.blocked ? <Badge tone="danger" size="sm">Blocked</Badge> : <Badge tone={LVL_TONE[r.level]} size="sm">Level {r.level}</Badge>}</td>
                <td className="py-2.5 pr-4 tabular-nums">{r.spendCap}</td>
                <td className="py-2.5 pr-4 text-[var(--c-fg-dim)]">{r.rollback}</td>
                <td className="py-2.5 pr-4"><PolicyBadge state={r.state} act={act} label={r.category} compact /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile cards */}
      <ul className="space-y-2.5 md:hidden">
        {CATEGORY_GOVERNANCE.map((r) => (
          <li key={r.category} className="rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-[var(--c-fg)]">{r.category}</span>
              {r.blocked ? <Badge tone="danger" size="sm">Blocked</Badge> : <Badge tone={LVL_TONE[r.level]} size="sm">Level {r.level}</Badge>}
            </div>
            <dl className="mt-2"><KV label="Spend cap" value={r.spendCap} /><KV label="Rollback" value={r.rollback} /></dl>
            <div className="mt-1"><PolicyBadge state={r.state} act={act} label={r.category} compact /></div>
          </li>
        ))}
      </ul>
    </>
  )
}

export function SpendControl({ act }) {
  const { SPEND } = useData()
  const pct = (n) => `${Math.min(100, (n / SPEND.budget) * 100)}%`
  return (
    <SettingsCard title="Agentic Spend Control" description="Budget, caps, and per-category allocation." icon={Zap}
      actions={<>
        <Button variant="outline" size="xs" disabled={!can(act.role, 'editSpend')} onClick={() => act('Edit allocation', 'editSpend')}>Edit Allocation</Button>
        <Button variant="ghost" size="xs" onClick={() => act('Delegation rules')}>Delegation Rules</Button>
        <Button variant="ghost" size="xs" leftIcon={<Download className="h-3.5 w-3.5" />} onClick={() => act('Export finance report', 'viewAudit')}>Export Finance Report</Button>
      </>}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="flex items-end justify-between">
            <div><div className="text-[24px] font-bold tabular-nums text-[var(--c-fg)]">{money(SPEND.current)}</div><div className="text-[12px] text-[var(--c-fg-muted)]">of {money(SPEND.budget)} budget</div></div>
            <div className="text-right"><div className="text-[13px] font-semibold text-[var(--c-warn)] tabular-nums">Projected {money(SPEND.projected)}</div></div>
          </div>
          {/* Budget bar with soft/hard cap markers */}
          <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-[var(--c-bg-3)]">
            <div className="h-full rounded-full bg-[var(--c-accent)]" style={{ width: pct(SPEND.current) }} />
            <span className="absolute top-0 h-full w-0.5 bg-[var(--c-warn)]" style={{ left: pct(SPEND.softCap) }} title={`Soft cap ${money(SPEND.softCap)}`} />
            <span className="absolute top-0 h-full w-0.5 bg-[var(--c-danger)]" style={{ left: pct(SPEND.hardCap) }} title={`Hard cap ${money(SPEND.hardCap)}`} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--c-warn)]" />Soft cap {money(SPEND.softCap)}</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--c-danger)]" />Hard cap {money(SPEND.hardCap)}</span>
          </div>
        </div>
        <div>
          <SectionLabel>Category allocation</SectionLabel>
          <ul className="space-y-2">
            {SPEND.allocation.map((a) => (
              <li key={a.category}>
                <div className="mb-1 flex items-center justify-between text-[12.5px]"><span className="text-[var(--c-fg-dim)]">{a.category}</span><span className="font-medium tabular-nums text-[var(--c-fg)]">{money(a.amount)}</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--c-bg-3)]"><div className="h-full rounded-full bg-[var(--c-accent-2)]" style={{ width: `${(a.amount / SPEND.hardCap) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SettingsCard>
  )
}

/* ══════════════════════════════ Section 4 · Notifications ══════════════════════════════ */

function NotificationsSection({ act }) {
  const N = useData().NOTIFICATIONS
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <SettingsCard title="Delivery Channels" icon={Bell}>
          <div className="space-y-2.5">{N.channels.map((c) => <SettingToggle key={c.key} label={c.label} value={c.value} act={act} sectionLabel="Delivery Channels" />)}</div>
        </SettingsCard>
        <SettingsCard title="Quiet Hours" icon={Settings2}>
          <dl><KV label="Weekday" value={N.quietHours.weekday} /><KV label="Weekend" value={N.quietHours.weekend} /></dl>
          <Button variant="outline" size="xs" className="mt-3" onClick={() => act('Edit quiet hours', 'editUserPref')}>Edit quiet hours</Button>
        </SettingsCard>
        <SettingsCard title="Focus Mode" icon={Zap}>
          <SectionLabel>Allowed notifications</SectionLabel>
          <div className="flex flex-wrap gap-2">{N.focusMode.allowed.map((a) => <Badge key={a} tone="accent" size="md">{a}</Badge>)}</div>
          <SectionLabel className="mt-3">Exceptions</SectionLabel>
          <div className="flex flex-wrap gap-2">{N.focusMode.exceptions.map((a) => <Badge key={a} tone="neutral" size="md">{a}</Badge>)}</div>
        </SettingsCard>
        <SettingsCard title="Vacation Mode" icon={FileText}>
          <dl><KV label="Status" value={N.vacation.active ? 'On' : 'Off'} strong /><KV label="Dates" value={N.vacation.dates} /><KV label="Suppress notifications" value={N.vacation.suppress ? 'Yes' : 'No'} /><KV label="Auto reply" value={N.vacation.autoReply} /></dl>
        </SettingsCard>
      </div>

      <SettingsCard title="Delegated Notifications" icon={User}>
        <div className="grid gap-2.5 sm:grid-cols-3">{N.delegated.map((d) => <SettingToggle key={d.key} label={d.label} value={d.value} act={act} sectionLabel="Delegated Notifications" />)}</div>
      </SettingsCard>

      <SettingsCard title="Categories" description="Choose channels per notification category." icon={Bell}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--c-line)] text-[11px] uppercase tracking-wide text-[var(--c-fg-muted)]">
                <th className="py-2 pr-4 font-semibold">Category</th>
                {['Desktop', 'Email', 'Push', 'SMS'].map((h) => <th key={h} className="py-2 pr-4 text-center font-semibold">{h}</th>)}
                <th className="py-2 font-semibold">Policy</th>
              </tr>
            </thead>
            <tbody>
              {N.categories.map((c) => (
                <tr key={c.key} className="border-b border-[var(--c-line)] last:border-0">
                  <td className="py-2.5 pr-4 font-medium">{c.label}</td>
                  {['desktop', 'email', 'push', 'sms'].map((ch) => <td key={ch} className="py-2.5 pr-4 text-center"><CheckCell on={c[ch]} /></td>)}
                  <td className="py-2.5">{c.state ? <PolicyBadge state={c.state} act={act} label={c.label} compact /> : <span className="text-[11px] text-[var(--c-fg-muted)]">User</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsCard>
    </div>
  )
}
function CheckCell({ on }) {
  return on
    ? <Check className="mx-auto h-4 w-4 text-[var(--c-success)]" />
    : <span className="mx-auto block h-1 w-3 rounded-full bg-[var(--c-line-strong)]" />
}

/* ══════════════════════════════ Section 5 · Privacy & Security ══════════════════════════════ */

function PrivacySection({ act }) {
  const { CONFIDENTIAL_MODES, CURRENT_CONFIDENTIAL, CONFIDENTIAL_EFFECTS, PRIVACY_CARDS } = useData()
  const navigate = useNavigate()
  const [mode, setMode] = useState(CURRENT_CONFIDENTIAL)
  // Workspace-policy card is admin-only — a Standard User must not even see it
  // (backend enforces too; this hides the surface). Account security below
  // stays visible to everyone.
  const isAdmin = can(act.role, 'editWorkspace')
  return (
    <div className="space-y-4">
      {isAdmin && (
      <SettingsCard title="Confidential Mode Defaults" description="When end-to-end confidential meetings are suggested or enforced." icon={Shield}
        actions={<PolicyBadge state="workspace_inherited" act={act} label="Confidential Mode" compact />}>
        <div className="space-y-2">
          {CONFIDENTIAL_MODES.map((m) => (
            <label key={m.key} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors',
              mode === m.key ? 'border-[var(--c-accent)] bg-[var(--c-accent-soft)]' : 'border-[var(--c-line)] bg-[var(--c-bg-2)] hover:bg-[var(--c-bg-3)]')}>
              <input type="radio" name="confmode" checked={mode === m.key} onChange={() => { setMode(m.key); act.markDirty('Privacy & Security:Confidential Mode', m.label) }} className="mt-0.5 accent-[var(--c-accent)]" />
              <span><span className="block text-[13.5px] font-medium text-[var(--c-fg)]">{m.label}</span><span className="block text-[12px] text-[var(--c-fg-muted)]">{m.desc}</span></span>
            </label>
          ))}
        </div>
        <div className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--c-accent)_22%,var(--c-line))] bg-[var(--c-accent-soft)] p-3">
          <SectionLabel><span className="text-[var(--c-accent)]">When active</span></SectionLabel>
          <div className="flex flex-wrap gap-2">{CONFIDENTIAL_EFFECTS.map((e) => <span key={e} className="inline-flex items-center gap-1 rounded-full border border-[var(--c-line)] bg-[var(--c-surface)] px-2 py-0.5 text-[11.5px] text-[var(--c-fg-dim)]"><Lock className="h-3 w-3" />{e}</span>)}</div>
        </div>
      </SettingsCard>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {PRIVACY_CARDS.map((c) => <SecurityCard key={c.key} c={c} act={act} onManage={c.key === 'sessions' ? () => navigate('/security') : undefined} />)}
      </div>

      <SettingsCard title="Account security" description="Password, sign-out and account deletion." icon={ShieldCheck}>
        <Button variant="outline" size="sm" rightIcon={<ChevronRight className="h-4 w-4" />} onClick={() => navigate('/security')}>Manage password &amp; account</Button>
      </SettingsCard>
    </div>
  )
}

export function SecurityCard({ c, act, onManage }) {
  const { POLICY } = useData()
  const p = POLICY[c.state]
  return (
    <div className="flex flex-col rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13.5px] font-semibold text-[var(--c-fg)]">{c.title}</span>
        {p?.compliance && <Shield className="h-4 w-4 shrink-0 text-[var(--c-warn)]" title="Compliance critical" />}
      </div>
      <div className="mt-1 text-[13px] text-[var(--c-fg-dim)]">{c.value}</div>
      <p className="mt-0.5 flex-1 text-[11.5px] text-[var(--c-fg-muted)]">{c.desc}</p>
      <div className="mt-2"><PolicyBadge state={c.state} act={act} label={c.title} compact /></div>
      <Button variant="outline" size="xs" className="mt-3 self-start"
        onClick={() => (onManage ? onManage() : p?.compliance ? act.compliance('Privacy & Security', c.title, c.action, () => {}) : act(`${c.action} — ${c.title}`))}>
        {c.action}
      </Button>
    </div>
  )
}

/* ══════════════════════════════ Section 6 · Integrations ══════════════════════════════ */

const MCP_STATUS = {
  healthy: { tone: 'success', label: 'Healthy' },
  reduced_scope: { tone: 'warn', label: 'Reduced Scope' },
  expiring: { tone: 'danger', label: 'Credential expiring' },
}

function IntegrationsSection({ act }) {
  const { INTEGRATIONS, MCP_SERVERS } = useData()
  return (
    <div className="space-y-4">
      <SettingsCard title="Integrations" description="Connected calendars, CRM, and outbound webhooks." icon={Plug}>
        <div className="grid gap-3 sm:grid-cols-3">
          {INTEGRATIONS.map((i) => (
            <div key={i.key} className="flex flex-col rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-4">
              <div className="flex items-center justify-between gap-2"><span className="text-[13.5px] font-semibold text-[var(--c-fg)]">{i.title}</span><Badge tone="success" size="sm">Connected</Badge></div>
              <p className="mt-1 flex-1 text-[12px] text-[var(--c-fg-muted)]">{i.desc}</p>
              <div className="mt-2 text-[12px] text-[var(--c-fg-dim)]">{i.detail}</div>
              <div className="mt-3 flex gap-2"><Button variant="ghost" size="xs" onClick={() => act(`Configure ${i.title}`)}>Configure</Button><Button variant="ghost" size="xs" onClick={() => act.credential(i.title)}>Test connection</Button></div>
            </div>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="MCP Servers" description="Model Context Protocol servers your AI can call, with scoped tools." icon={Zap}
        actions={<Button variant="primary" size="xs" onClick={() => act.credential('New MCP Server')}>Connect New MCP Server</Button>}>
        <div className="grid gap-3 md:grid-cols-2">
          {MCP_SERVERS.map((m) => <MCPServerCard key={m.name} m={m} act={act} />)}
        </div>
      </SettingsCard>
    </div>
  )
}

export function MCPServerCard({ m, act }) {
  const st = MCP_STATUS[m.status]
  return (
    <div className="flex flex-col rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13.5px] font-semibold text-[var(--c-fg)]">{m.name}</span>
        <Badge tone={st.tone} size="sm" dot pulse={m.status !== 'healthy'}>{st.label}</Badge>
      </div>
      {m.warning && (
        <div className={cn('mt-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px]', m.status === 'expiring' ? 'bg-[var(--c-danger-soft)] text-[var(--c-danger)]' : 'bg-[var(--c-warn-soft)] text-[var(--c-warn)]')}>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{m.warning}
        </div>
      )}
      <SectionLabel className="mt-3">Tools</SectionLabel>
      <div className="flex flex-wrap gap-1.5">{m.tools.map((t) => <span key={t} className="rounded-md border border-[var(--c-line)] bg-[var(--c-surface)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--c-fg-dim)]">{t}</span>)}</div>
      <SectionLabel className="mt-3">Scopes</SectionLabel>
      <div className="flex flex-wrap gap-1.5">{m.scopes.map((s) => <Badge key={s} tone="accent" size="sm">{s}</Badge>)}</div>
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--c-line)] pt-3">
        {m.actions.map((a) => {
          const danger = a === 'Disconnect'
          const cred = a === 'Rotate Credentials' || a === 'Reconnect'
          return <Button key={a} variant={danger ? 'ghost' : cred ? 'outline' : 'ghost'} size="xs"
            className={danger ? '!text-[var(--c-danger)]' : undefined}
            onClick={() => (cred ? act.credential(`${a} — ${m.name}`) : act(`${a} — ${m.name}`, a === 'View Audit' ? 'viewAudit' : 'rotateCredentials'))}>{a}</Button>
        })}
      </div>
    </div>
  )
}

/* ══════════════════════════════ Section 7 · Advanced ══════════════════════════════ */

function AdvancedSection({ act }) {
  const { TELEPHONY, WORKSPACE_DEFAULTS, ACCESSIBILITY, SAFE_TEMPLATES, IMPORT_SOURCES } = useData()
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <SettingsCard title="Telephony" icon={Zap} actions={<PolicyBadge state={TELEPHONY.state} act={act} label="Telephony" compact />}>
          <dl><KV label="Emergency address" value={TELEPHONY.emergencyAddress} /><KV label="Dial region" value={TELEPHONY.dialRegion} /></dl>
          <div className="mt-2 rounded-lg bg-[var(--c-success-soft)] px-3 py-2 text-[12px] text-[var(--c-success)]">{TELEPHONY.diagnostics}</div>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="xs" onClick={() => act.compliance('Advanced', 'Emergency address', 'update', () => {})}>Update emergency address</Button>
            <Button variant="ghost" size="xs" onClick={() => act('Run SIP/PSTN diagnostics')}>Run diagnostics</Button>
          </div>
        </SettingsCard>
        <SettingsCard title="Workspace Defaults" icon={Building2}>
          <div className="space-y-2">
            {WORKSPACE_DEFAULTS.map((w) => (
              <div key={w.key} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] px-3.5 py-2.5">
                <span className="min-w-0"><span className="block text-[13px] font-medium text-[var(--c-fg)]">{w.label}</span><span className="block text-[12px] text-[var(--c-fg-muted)]">{w.value}</span></span>
                <PolicyBadge state={w.state} act={act} label={w.label} compact />
              </div>
            ))}
          </div>
        </SettingsCard>
      </div>

      <SettingsCard title="Accessibility" description="WCAG 2.2 AA — display and interaction preferences." icon={User}>
        <div className="grid gap-2.5 sm:grid-cols-2">{ACCESSIBILITY.map((s) => <SettingRow key={s.key} s={s} act={act} sectionLabel="Accessibility" />)}</div>
      </SettingsCard>

      <SettingsCard title="Safe Templates" description="Apply an industry-hardened baseline in one step." icon={Shield}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {SAFE_TEMPLATES.map((t) => (
            <div key={t.key} className={cn('flex flex-col rounded-xl border p-4', t.active ? 'border-[var(--c-accent)] bg-[var(--c-accent-soft)]' : 'border-[var(--c-line)] bg-[var(--c-bg-2)]')}>
              <div className="flex items-center justify-between gap-2"><span className="text-[13.5px] font-semibold text-[var(--c-fg)]">{t.label}</span>{t.active && <Badge tone="accent" size="sm">Active</Badge>}</div>
              <p className="mt-1 flex-1 text-[12px] text-[var(--c-fg-muted)]">{t.desc}</p>
              <Button variant={t.active ? 'ghost' : 'outline'} size="xs" className="mt-3 self-start" disabled={t.active || !can(act.role, 'editWorkspace')} onClick={() => act.compliance('Advanced', 'Safe template', t.label, () => {})}>{t.active ? 'Applied' : 'Apply template'}</Button>
            </div>
          ))}
        </div>
      </SettingsCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SettingsCard title="Import / Export" description="Move settings in and out of Zoiko Sema." icon={Download}>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" leftIcon={<Download className="h-4 w-4" />} onClick={() => act('Export settings JSON')}>Export JSON</Button>
            {IMPORT_SOURCES.map((s) => <Button key={s} variant="ghost" size="sm" leftIcon={<Upload className="h-4 w-4" />} onClick={() => act.credential(`Import from ${s}`)}>Import from {s}</Button>)}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--c-line)] pt-3">
            <Button variant="ghost" size="xs" onClick={() => act('Compare workspaces')}>Compare workspaces</Button>
            <Button variant="ghost" size="xs" onClick={() => act('Replicate settings', 'editWorkspace')}>Replicate settings</Button>
          </div>
        </SettingsCard>
        <DelegationCard act={act} />
      </div>
    </div>
  )
}

export function DelegationCard({ act }) {
  const { DELEGATIONS } = useData()
  return (
    <SettingsCard title="Delegated Access" description="People who can act on your behalf, with scoped permissions." icon={User}>
      <div className="space-y-3">
        {DELEGATIONS.map((d) => (
          <div key={d.name} className="rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-4">
            <div className="flex items-center gap-3">
              <Avatar name={d.name} color={d.avatarColor} size="md" />
              <div className="min-w-0"><div className="text-[14px] font-semibold text-[var(--c-fg)]">{d.name}</div><div className="text-[12px] text-[var(--c-fg-muted)]">{d.role}</div></div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div><SectionLabel><span className="text-[var(--c-success)]">Can</span></SectionLabel><ul className="space-y-1">{d.can.map((x) => <li key={x} className="flex items-center gap-1.5 text-[12.5px] text-[var(--c-fg-dim)]"><Check className="h-3.5 w-3.5 text-[var(--c-success)]" />{x}</li>)}</ul></div>
              <div><SectionLabel><span className="text-[var(--c-danger)]">Cannot</span></SectionLabel><ul className="space-y-1">{d.cannot.map((x) => <li key={x} className="flex items-center gap-1.5 text-[12.5px] text-[var(--c-fg-muted)]"><X className="h-3.5 w-3.5 text-[var(--c-danger)]" />{x}</li>)}</ul></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--c-line)] pt-3">
              {d.actions.map((a) => <Button key={a} variant={a === 'Revoke' ? 'ghost' : 'outline'} size="xs" className={a === 'Revoke' ? '!text-[var(--c-danger)]' : undefined} onClick={() => act(`${a} — ${d.name}`, 'editWorkspace')}>{a}</Button>)}
            </div>
          </div>
        ))}
      </div>
    </SettingsCard>
  )
}

/* ══════════════════════════════ Recent changes / audit ══════════════════════════════ */

export function AuditTimeline({ act }) {
  const { RECENT_CHANGES } = useData()
  return (
    <SettingsCard title="Recent Changes" description="Setting changes in the last 30 days." icon={FileText}
      actions={<Button variant="outline" size="xs" onClick={() => act('View full audit log', 'viewAudit')}>View Full Audit Log</Button>}>
      <ol className="relative space-y-4 pl-5">
        <span aria-hidden className="absolute left-[5px] top-1 bottom-1 w-px bg-[var(--c-line)]" />
        {RECENT_CHANGES.map((c) => (
          <li key={c.id} className="relative">
            <span aria-hidden className="absolute -left-5 top-1 h-2.5 w-2.5 rounded-full bg-[var(--c-accent)] ring-4 ring-[var(--c-surface)]" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-[var(--c-fg)]">{c.title} <span className="font-normal text-[var(--c-fg-muted)]">· {c.section}</span></span>
              <span className="font-mono text-[11px] text-[var(--c-fg-muted)]">{c.when}</span>
            </div>
            <div className="text-[12.5px] text-[var(--c-fg-dim)]">{c.detail}</div>
            <div className="mt-0.5 text-[11.5px] text-[var(--c-fg-muted)]">by {c.by} ({c.role}) · {c.device}</div>
            <div className="mt-1.5 flex gap-2">
              <Button variant="ghost" size="xs" onClick={() => act(`View ${c.id}`)}>View</Button>
              <Button variant="ghost" size="xs" disabled={!c.revertible} title={c.revertible ? undefined : 'This change cannot be reverted'} onClick={() => act.compliance(c.section, c.title, 'revert', () => {})}>Revert</Button>
            </div>
          </li>
        ))}
      </ol>
    </SettingsCard>
  )
}

/* ══════════════════════════════ compliance / re-auth modal ══════════════════════════════ */

function ComplianceModal({ req, onClose, onConfirm }) {
  const [pw, setPw] = useState('')
  if (!req) return null
  return (
    <Modal open={!!req} onClose={onClose} title="Confirm compliance-critical change" size="md"
      description="This change is logged to the audit trail and requires you to re-authenticate."
      footer={<>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant="primary" size="sm" disabled={pw.length < 4} leftIcon={<Shield className="h-4 w-4" />} onClick={() => onConfirm(pw)}>Re-authenticate &amp; apply</Button>
      </>}>
      <div className="space-y-3">
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--c-warn)_25%,var(--c-line))] bg-[var(--c-warn-soft)] p-3 text-[12.5px] text-[var(--c-fg-dim)]">
          <div className="flex items-center gap-2 font-semibold text-[var(--c-warn)]"><Shield className="h-4 w-4" />{req.section} · {req.label}</div>
          <div className="mt-1">New value: <span className="font-medium text-[var(--c-fg)]">{String(req.value)}</span></div>
        </div>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-[var(--c-fg-dim)]">Confirm your password</span>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password"
            className="w-full rounded-lg border border-[var(--c-line-strong)] bg-[var(--c-surface)] px-3 py-2 text-[13.5px] text-[var(--c-fg)] outline-none focus:border-[var(--c-accent)] focus:ring-2 focus:ring-[var(--c-accent-ring)]" />
        </label>
        <p className="text-[11.5px] text-[var(--c-fg-muted)]">An audit entry (actor, role, old/new value, device) will be recorded.</p>
      </div>
    </Modal>
  )
}

/* ══════════════════════════════ page ══════════════════════════════ */

function SettingsPage({ data }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const [active, setActive] = useState('account')
  const [query, setQuery] = useState('')
  const [dirty, setDirty] = useState({}) // key -> value, for explicit-save workspace controls
  const [compliance, setCompliance] = useState(null) // { section, label, value, apply }

  const role = normalizeRole(data.role || user?.role)
  const actor = user?.email || user?.name || 'unknown'
  const { SECTIONS, POLICY_BANNER } = data

  const act = useMemo(() => {
    const fn = (label, cap) => {
      if (cap && !can(role, cap)) { toast({ variant: 'warning', title: 'Not permitted', description: `Your role (${role}) can’t: ${label}.` }); return }
      if (cap) recordAudit({ section: 'action', newValue: label, actor, role })
      toast({ variant: 'success', title: label, description: 'Recorded — demo action (no backend yet).' })
    }
    fn.role = role
    fn.toast = (t) => toast({ variant: 'success', title: t })
    fn.error = (t) => toast({ variant: 'error', title: 'Something went wrong', description: t })
    // Personal preference → autosave + toast
    fn.autosave = (section, label, value) => {
      recordAudit({ section, newValue: `${label}: ${value}`, actor, role })
      toast({ variant: 'success', title: 'Saved', description: `${label} · ${value}` })
    }
    // Workspace policy → mark dirty, surfaces the explicit Save bar
    fn.markDirty = (key, value) => setDirty((d) => ({ ...d, [key]: value }))
    // Compliance critical → confirmation + re-auth modal + audit
    fn.compliance = (section, label, value, apply) => setCompliance({ section, label, value, apply })
    // Integration credentials → test connection first, apply after validation
    fn.credential = (label) => {
      toast({ variant: 'info', title: `Testing connection…`, description: label })
      // ponytail: fake a successful validation; real flow awaits the test result.
      recordAudit({ section: 'integration', newValue: label, actor, role })
    }
    return fn
  }, [role, actor, toast])

  const dirtyCount = Object.keys(dirty).length
  const saveWorkspace = () => {
    Object.entries(dirty).forEach(([key, value]) => recordAudit({ section: key.split(':')[0], newValue: value, actor, role }))
    setDirty({})
    toast({ variant: 'success', title: 'Workspace settings saved', description: `${dirtyCount} change${dirtyCount === 1 ? '' : 's'} applied.` })
  }

  const confirmCompliance = () => {
    const { section, label, value, apply } = compliance
    recordAudit({ section, newValue: `${label}: ${value}`, actor, role, revertible: true })
    apply?.()
    setCompliance(null)
    toast({ variant: 'success', title: 'Applied & audited', description: `${label} — re-authenticated.` })
  }

  // Search filters the section nav; empty query shows all.
  const q = query.trim().toLowerCase()
  const shownSections = q ? SECTIONS.filter((s) => s.label.toLowerCase().includes(q)) : SECTIONS
  // If the active section is filtered out, fall back to the first match.
  const current = shownSections.some((s) => s.id === active) ? active : (shownSections[0]?.id || active)

  const SECTION_BODY = {
    account: AccountSection, meetings: MeetingsSection, ai: AISection,
    notifications: NotificationsSection, privacy: PrivacySection,
    integrations: IntegrationsSection, advanced: AdvancedSection,
  }
  const Body = SECTION_BODY[current] || AccountSection

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.03em] text-[var(--c-fg)]">Settings</h1>
          <p className="mt-1 max-w-2xl text-[14px] text-[var(--c-fg-muted)]">Manage your account, meetings, AI, notifications, privacy, integrations, and advanced controls.</p>
        </div>
        <Button variant="secondary" size="sm" leftIcon={<Sparkles className="h-4 w-4" />} onClick={() => act("What's New")}>What&apos;s New?</Button>
      </div>

      {/* Policy banner */}
      <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--c-warn)_20%,var(--c-line))] bg-[var(--c-warn-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-[var(--c-warn)]" />
          <div>
            <div className="text-[13.5px] font-semibold text-[var(--c-fg)]">Managed by {POLICY_BANNER.managedBy}</div>
            <div className="text-[12.5px] text-[var(--c-fg-dim)]">{POLICY_BANNER.lockedCount} settings locked · You are configuring{' '}
              {POLICY_BANNER.configuring.map((c, i) => <span key={c.label}>{i > 0 && ' · '}<span className="font-medium text-[var(--c-fg)]">{c.label}</span></span>)}
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" className="shrink-0 self-start sm:self-center" onClick={() => act('View policy')}>View Policy</Button>
      </div>

      <div className="mt-5 flex flex-col gap-5 lg:flex-row">
        {/* Section nav + sticky search */}
        <aside className="lg:w-[236px] lg:shrink-0">
          <div className="lg:sticky lg:top-[84px]">
            <label className="mb-3 flex h-10 items-center gap-2 rounded-xl border border-[var(--c-line)] bg-[var(--c-surface)] px-3 focus-within:border-[var(--c-accent)] focus-within:shadow-[0_0_0_3px_var(--c-accent-ring)]">
              <Search className="h-4 w-4 text-[var(--c-fg-muted)]" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search settings" aria-label="Search settings"
                className="min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none placeholder:text-[var(--c-fg-muted)]" />
            </label>
            <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
              {shownSections.map((s) => {
                const Icon = SECTION_ICONS[s.icon] || User
                const on = s.id === current
                return (
                  <button key={s.id} onClick={() => setActive(s.id)} aria-current={on ? 'page' : undefined}
                    className={cn('group flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors lg:w-full',
                      on ? 'bg-[var(--c-accent-soft)] text-[var(--c-fg)]' : 'text-[var(--c-fg-dim)] hover:bg-[var(--c-bg-3)] hover:text-[var(--c-fg)]')}>
                    <span className={cn('grid h-7 w-7 place-items-center rounded-lg [&_svg]:h-[17px] [&_svg]:w-[17px]', on ? 'bg-[var(--c-accent)] text-white' : 'bg-[var(--c-bg-3)] text-[var(--c-fg-muted)] group-hover:text-[var(--c-fg)]')}><Icon /></span>
                    <span className="truncate">{s.label}</span>
                  </button>
                )
              })}
              {shownSections.length === 0 && <p className="px-3 py-2 text-[12.5px] text-[var(--c-fg-muted)]">No sections match “{query}”.</p>}
            </nav>
          </div>
        </aside>

        {/* Content */}
        <div className="min-w-0 flex-1 space-y-5">
          <Body act={act} />
          <AuditTimeline act={act} />
        </div>
      </div>

      {/* Explicit-save unsaved-changes bar (workspace policy) */}
      {dirtyCount > 0 && (
        <div role="status" className="fixed inset-x-3 bottom-4 z-40 mx-auto flex max-w-[720px] items-center justify-between gap-3 rounded-2xl border border-[var(--c-line-strong)] bg-[var(--c-surface)] px-4 py-3 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.45)]">
          <span className="flex items-center gap-2 text-[13px] text-[var(--c-fg-dim)]"><AlertTriangle className="h-4 w-4 text-[var(--c-warn)]" />{dirtyCount} unsaved workspace change{dirtyCount === 1 ? '' : 's'}</span>
          <span className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDirty({})}>Discard</Button>
            <Button variant="primary" size="sm" leftIcon={<Save className="h-4 w-4" />} onClick={saveWorkspace}>Save changes</Button>
          </span>
        </div>
      )}

      <ComplianceModal req={compliance} onClose={() => setCompliance(null)} onConfirm={confirmCompliance} />
    </div>
  )
}

/* ══════════════════════════════ page (fetch + states) ══════════════════════════════ */

export default function Settings() {
  const { data, error, loading, reload } = useResource('/api/settings/overview')

  if (loading) {
    return <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8"><div className="flex items-center justify-center py-24"><Spinner size="lg" /></div></div>
  }
  if (error) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--c-line-strong)] py-20 text-center">
          <AlertTriangle className="h-8 w-8 text-[var(--c-danger)]" />
          <p className="text-[15px] font-semibold text-[var(--c-fg)]">Couldn’t load Settings</p>
          <p className="max-w-sm text-[13px] text-[var(--c-fg-muted)]">{error}</p>
          <Button variant="outline" size="sm" leftIcon={<RotateCcw className="h-4 w-4" />} onClick={reload}>Retry</Button>
        </div>
      </div>
    )
  }
  return (
    <SettingsDataContext.Provider value={data}>
      <SettingsPage data={data} />
    </SettingsDataContext.Provider>
  )
}
