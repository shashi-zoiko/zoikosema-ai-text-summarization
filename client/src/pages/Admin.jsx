import { useEffect, useState } from 'react'
import { api } from '../api/client'
import Icon from '../components/Icon'
import Avatar from '../components/Avatar'
import { cn } from '../lib/cn'
import { Sparkles, Shield, Users, MessageSquare } from 'lucide-react'

/* ─────────────────────────────────────────────────────────────────────────
 * Admin — fully Tailwind. The companion Admin.css has been removed; every
 * surface now reads off the design-token utilities (bg-bg-1 / text-fg /
 * border-line / bg-accent-soft / ...) so dark and light themes track
 * automatically.
 *
 * Logic is unchanged from the previous version.
 * ──────────────────────────────────────────────────────────────────────── */

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function Admin() {
  const [stats, setStats] = useState(null)
  const [users, setUsers] = useState([])
  const [meetings, setMeetings] = useState([])
  const [activity, setActivity] = useState([])
  const [guidePolicy, setGuidePolicy] = useState(null)
  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    Promise.all([
      api('/api/admin/stats'),
      api('/api/admin/users?limit=50'),
      api('/api/admin/meetings?limit=30'),
      api('/api/admin/activity?limit=20'),
      api('/api/admin/sema-guide/policy').catch(() => null),
    ])
      .then(([s, u, m, a, gp]) => {
        setStats(s); setUsers(u); setMeetings(m); setActivity(a); setGuidePolicy(gp)
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [])

  const searchUsers = async () => {
    try {
      const res = await api(`/api/admin/users?search=${encodeURIComponent(search)}&limit=50`)
      setUsers(res)
    } catch {}
  }

  const deleteUser = async (userId) => {
    if (!window.confirm('Permanently delete this user?')) return
    try {
      await api(`/api/admin/users/${userId}`, { method: 'DELETE' })
      setUsers(prev => prev.filter(u => u.id !== userId))
    } catch (e) {
      setErr(e.message)
    }
  }

  const purgeRecordings = async () => {
    const days = window.prompt(
      'Purge recordings older than how many days? (Leave blank for the configured retention)',
      ''
    )
    if (days === null) return
    const parsed = days.trim() === '' ? null : parseInt(days, 10)
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 1)) {
      window.alert('Days must be a positive integer')
      return
    }
    if (!window.confirm(parsed ? `Purge recordings older than ${parsed} days?` : 'Purge expired recordings using server retention?')) return
    try {
      const qs = parsed ? `?days=${parsed}` : ''
      const res = await api(`/api/admin/recordings/purge${qs}`, { method: 'POST' })
      window.alert(`Purged ${res.purged} recording${res.purged === 1 ? '' : 's'} (retention ${res.retention_days}d).`)
      try { setStats(await api('/api/admin/stats')) } catch {}
    } catch (e) {
      window.alert(`Purge failed: ${e.message}`)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1200px] flex-1 overflow-y-auto px-6 py-10 sm:px-12 sm:py-12">
        <div className="grid place-items-center py-20">
          <div className="spinner" />
        </div>
      </div>
    )
  }

  if (err && !stats) {
    return (
      <div className="mx-auto w-full max-w-[1200px] flex-1 overflow-y-auto px-6 py-10 sm:px-12 sm:py-12">
        <div
          className="rounded-[22px] border border-dashed border-line-strong px-6 py-20 text-center text-fg-muted"
          style={{ background: 'color-mix(in srgb, var(--c-danger) 5%, var(--c-bg-2))' }}
        >
          <Icon name="shield" size={32} />
          <h2 className="mt-4 mb-2 font-display text-[20px] font-bold tracking-[-0.02em] text-fg">
            Access denied
          </h2>
          <p>{err}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] flex-1 overflow-y-auto px-6 py-10 sm:px-12 sm:py-12">
      {/* ============ Hero ============ */}
      <header className="fade-in-up mb-6">
        <div className="mb-3.5">
          <span className="badge accent">
            <Icon name="userCog" size={12} />
            <span>Admin Panel</span>
          </span>
        </div>
        <h1
          className="m-0 mb-1.5 font-display text-[32px] font-bold tracking-[-0.035em]"
          style={{
            background: 'linear-gradient(135deg, var(--c-fg) 0%, color-mix(in srgb, var(--c-accent) 65%, var(--c-fg)) 70%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          System Administration
        </h1>
        <p className="m-0 text-[15px] text-fg-dim">
          Monitor your platform, manage users, and review system activity.
        </p>
      </header>

      {/* ============ Tabs ============ */}
      <div className="mb-6 flex gap-1 border-b border-line">
        {[
          { key: 'overview', label: 'Overview', icon: 'chart' },
          { key: 'users', label: 'Users', icon: 'users' },
          { key: 'meetings', label: 'Meetings', icon: 'video' },
          { key: 'ai-guide', label: 'AI & Guide', icon: 'sparkles' },
          { key: 'activity', label: 'Activity', icon: 'activity' },
        ].map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'group/tab relative -mb-px inline-flex items-center gap-1.5 !border-0 !bg-transparent px-4 py-2.5 text-[13px] font-semibold !shadow-none transition',
                'rounded-t-[10px] !rounded-b-none',
                active
                  ? 'text-accent'
                  : 'text-fg-muted hover:-translate-y-px hover:text-fg'
              )}
              style={active ? { background: 'color-mix(in srgb, var(--c-accent) 8%, transparent)' } : undefined}
            >
              <Icon name={t.icon} size={14} /> {t.label}
              {active && (
                <span
                  aria-hidden
                  className="absolute -bottom-px left-3 right-3 h-0.5 rounded-t"
                  style={{ background: 'linear-gradient(90deg, transparent, var(--c-accent), var(--c-accent-3), transparent)' }}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* ============ Overview ============ */}
      {tab === 'overview' && stats && (
        <>
          <div className="mb-4 flex flex-wrap gap-2.5">
            <button
              className="ghost"
              onClick={purgeRecordings}
              title="Run the expired-recordings sweep now"
            >
              <Icon name="trash" size={14} /> Purge old recordings
            </button>
          </div>

          <div className="mb-7 grid grid-cols-2 gap-3.5 sm:grid-cols-3">
            {[
              { label: 'Total users', value: stats.total_users, icon: 'users', accent: true },
              { label: 'New this week', value: stats.users_this_week, icon: 'trendUp' },
              { label: 'Total meetings', value: stats.total_meetings, icon: 'video' },
              { label: 'This week', value: stats.meetings_this_week, icon: 'calendar' },
              { label: 'This month', value: stats.meetings_this_month, icon: 'calendar' },
              { label: 'Active now', value: stats.active_meetings, icon: 'bolt', accent: true },
              { label: 'Recordings', value: stats.total_recordings, icon: 'record' },
              { label: 'Organizations', value: stats.total_organizations, icon: 'building' },
              { label: 'Total joins', value: stats.total_participants_joined, icon: 'userPlus' },
            ].map((s, i) => (
              <StatCard key={i} {...s} delay={i * 40} />
            ))}
          </div>
        </>
      )}

      {/* ============ Users ============ */}
      {tab === 'users' && (
        <Section>
          <div className="mb-4 flex gap-2.5">
            <div className="flex flex-1 items-center gap-2 rounded-md border border-line-strong bg-bg-1 px-3 text-fg-muted transition focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--c-accent-ring)]">
              <Icon name="search" size={14} />
              <input
                placeholder="Search users by name or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') searchUsers() }}
                className="flex-1 !border-0 !bg-transparent px-0 py-2.5 text-[13px] text-fg !shadow-none placeholder:text-fg-muted focus:!shadow-none"
              />
            </div>
            <button className="primary" onClick={searchUsers}>Search</button>
          </div>

          <Table head={[
            { label: 'User',    flex: '2fr' },
            { label: 'Email',   flex: '2fr' },
            { label: 'Meetings', flex: '1fr' },
            { label: 'Joined',  flex: '1fr' },
            { label: 'Actions', flex: '0.7fr' },
          ]}>
            {users.map((u) => (
              <TableRow key={u.id} cols="2fr 2fr 1fr 1fr 0.7fr">
                <Cell className="!gap-2.5">
                  <Avatar name={u.name} color={u.avatar_color} size="sm" />
                  <div>
                    <div className="flex items-center gap-1.5 font-medium text-fg">
                      {u.name}
                      {u.is_admin && <span className="badge sm accent">Admin</span>}
                    </div>
                  </div>
                </Cell>
                <Cell className="text-[12px] text-fg-muted">{u.email}</Cell>
                <Cell>{u.meeting_count}</Cell>
                <Cell>{formatDate(u.created_at)}</Cell>
                <Cell>
                  {!u.is_admin && (
                    <button
                      className="grid h-[30px] w-[30px] place-items-center !rounded-md !border-transparent !bg-transparent !p-0 text-fg-muted !shadow-none transition hover:!border-danger/20 hover:!bg-danger-soft hover:!text-danger"
                      onClick={() => deleteUser(u.id)}
                      title="Delete user"
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </Cell>
              </TableRow>
            ))}
          </Table>
        </Section>
      )}

      {/* ============ Meetings ============ */}
      {tab === 'meetings' && (
        <Section>
          <Table head={[
            { label: 'Meeting',      flex: '2fr' },
            { label: 'Host',         flex: '2fr' },
            { label: 'Participants', flex: '1fr' },
            { label: 'Status',       flex: '1fr' },
            { label: 'Created',      flex: '0.7fr' },
          ]}>
            {meetings.map((m) => (
              <TableRow key={m.id} cols="2fr 2fr 1fr 1fr 0.7fr">
                <Cell className="flex-col !items-start !gap-0.5">
                  <div className="truncate font-medium text-fg">{m.title}</div>
                  <div className="font-mono text-[11px] text-fg-muted">{m.code}</div>
                </Cell>
                <Cell className="flex-col !items-start !gap-0.5">
                  <div>{m.host_name}</div>
                  <div className="text-[11px] text-fg-muted">{m.host_email}</div>
                </Cell>
                <Cell>{m.participant_count}</Cell>
                <Cell className="!gap-1">
                  <span className={cn('badge sm', m.is_active ? 'live' : 'muted')}>
                    {m.is_active ? 'Active' : 'Ended'}
                  </span>
                  {m.locked && <span className="badge sm">Locked</span>}
                  {m.password_protected && <Icon name="lock" size={11} className="text-fg-muted" />}
                </Cell>
                <Cell>{formatDate(m.created_at)}</Cell>
              </TableRow>
            ))}
          </Table>
        </Section>
      )}

      {/* ============ AI & Guide ============ */}
      {tab === 'ai-guide' && guidePolicy && (
        <Section>
          <div className="mb-5">
            <h2 className="mb-1 text-[18px] font-semibold">Sema Guide Policy</h2>
            <p className="text-[13px] text-fg-muted">Configure AI support agent behaviour and tenant-level controls.</p>
          </div>

          <div className="mb-6 grid gap-3 sm:grid-cols-2">
            <ToggleCard
              icon={<Sparkles className="h-4 w-4" />}
              label="AI responses enabled"
              description="Allow Sema Guide to answer questions using AI"
              checked={guidePolicy.ai_enabled}
              onChange={(v) => updateGuidePolicy('ai_enabled', v)}
            />
            <ToggleCard
              icon={<MessageSquare className="h-4 w-4" />}
              label="Quick actions enabled"
              description="Show contextual action suggestions in the panel"
              checked={guidePolicy.quick_actions_enabled}
              onChange={(v) => updateGuidePolicy('quick_actions_enabled', v)}
            />
            <ToggleCard
              icon={<Users className="h-4 w-4" />}
              label="Human handoff enabled"
              description="Allow users to request a human specialist"
              checked={guidePolicy.human_handoff_enabled}
              onChange={(v) => updateGuidePolicy('human_handoff_enabled', v)}
            />
            <ToggleCard
              icon={<Shield className="h-4 w-4" />}
              label="Confidential Mode"
              description="Block meeting content access in support panel"
              checked={guidePolicy.confidential_mode_enabled}
              onChange={(v) => updateGuidePolicy('confidential_mode_enabled', v)}
            />
          </div>

          <div className="rounded-xl border border-line bg-bg-1 p-4">
            <h3 className="mb-3 text-[14px] font-semibold">Usage limits</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">Max actions</label>
                <input
                  type="number"
                  value={guidePolicy.max_actions}
                  min={1}
                  max={12}
                  onChange={(e) => updateGuidePolicy('max_actions', parseInt(e.target.value, 10) || 6)}
                  className="w-full rounded-lg border border-line-strong bg-bg-2 px-3 py-2 text-[13px] text-fg"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">Rate limit (req/min)</label>
                <input
                  type="number"
                  value={guidePolicy.rate_limit_per_minute}
                  min={1}
                  onChange={(e) => updateGuidePolicy('rate_limit_per_minute', parseInt(e.target.value, 10) || 60)}
                  className="w-full rounded-lg border border-line-strong bg-bg-2 px-3 py-2 text-[13px] text-fg"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-muted">Retention (days)</label>
                <input
                  type="number"
                  value={guidePolicy.retention_days}
                  min={1}
                  onChange={(e) => updateGuidePolicy('retention_days', parseInt(e.target.value, 10) || 90)}
                  className="w-full rounded-lg border border-line-strong bg-bg-2 px-3 py-2 text-[13px] text-fg"
                />
              </div>
            </div>
          </div>
        </Section>
      )}

      {/* ============ Activity ============ */}
      {tab === 'activity' && (
        <Section>
          <div className="flex flex-col gap-0.5">
            {activity.map((e, i) => (
              <div
                key={i}
                className="group/act flex items-center gap-3 rounded-[14px] px-3 py-2.5 transition hover:translate-x-0.5"
                style={{ backgroundColor: 'transparent' }}
                onMouseEnter={(ev) => ev.currentTarget.style.background = 'color-mix(in srgb, var(--c-accent) 5%, transparent)'}
                onMouseLeave={(ev) => ev.currentTarget.style.background = 'transparent'}
              >
                <ActivityIcon type={e.type} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-fg">{e.message}</div>
                  <div className="mt-0.5 text-[11px] text-fg-muted">{formatDate(e.timestamp)}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

/* ────────────────────── pieces ────────────────────── */

function StatCard({ label, value, icon, accent, delay = 0 }) {
  return (
    <div
      className="group/stat fade-in-up relative isolate flex flex-col gap-2.5 overflow-hidden rounded-[18px] border border-line bg-bg-1 p-5 shadow-sm transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-px"
      style={{
        animationDelay: `${delay}ms`,
        boxShadow: 'var(--shadow-sm)',
      }}
      onMouseEnter={(ev) => {
        ev.currentTarget.style.borderColor = 'color-mix(in srgb, var(--c-accent) 28%, var(--c-line-strong))'
        ev.currentTarget.style.boxShadow = '0 22px 48px -18px color-mix(in srgb, var(--c-accent) 30%, rgba(0,0,0,0.4))'
      }}
      onMouseLeave={(ev) => {
        ev.currentTarget.style.borderColor = ''
        ev.currentTarget.style.boxShadow = 'var(--shadow-sm)'
      }}
    >
      {/* Hover overlay — gentle gradient wash from corner to corner */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-inherit opacity-0 transition-opacity duration-300 group-hover/stat:opacity-100"
        style={{
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--c-accent) 10%, transparent), transparent 40%, color-mix(in srgb, var(--c-accent-3) 8%, transparent))',
          mixBlendMode: 'screen',
        }}
      />
      <div
        className={cn(
          'relative grid h-[38px] w-[38px] place-items-center rounded-md border transition-[transform,background,box-shadow] duration-200 group-hover/stat:scale-[1.12] group-hover/stat:-rotate-[6deg]',
          accent
            ? 'border-[color-mix(in_srgb,var(--c-accent)_20%,transparent)] bg-accent-soft text-accent'
            : 'border-line bg-bg-3 text-fg-dim'
        )}
      >
        <Icon name={icon} size={18} />
      </div>
      <div className="relative font-display text-[26px] font-bold tracking-[-0.035em] tabular-nums text-fg">
        {value}
      </div>
      <div className="relative text-[12px] uppercase tracking-[0.04em] text-fg-muted">
        {label}
      </div>
    </div>
  )
}

function Section({ children }) {
  return <div className="mb-7">{children}</div>
}

function Table({ head, children }) {
  return (
    // Horizontal scroll on narrow screens so the fr-columns don't squish into an
    // unreadable mush; min-width keeps the layout legible and the header aligned
    // with the rows (both share the same column template).
    <div className="overflow-hidden rounded-[16px] border border-line bg-bg-1 shadow-sm">
      <div className="zk-rail overflow-x-auto">
        <div className="min-w-[640px]">
          <div
            className="grid border-b border-line px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[0.10em] text-fg-muted backdrop-blur-md"
            style={{
              gridTemplateColumns: head.map((h) => h.flex).join(' '),
              background: 'linear-gradient(180deg, color-mix(in srgb, var(--c-surface) 88%, transparent), color-mix(in srgb, var(--c-surface) 68%, transparent))',
            }}
          >
            {head.map((h, i) => (<span key={i}>{h.label}</span>))}
          </div>
          <div>{children}</div>
        </div>
      </div>
    </div>
  )
}

function TableRow({ cols, children }) {
  return (
    <div
      className="grid items-center border-b border-line px-4 py-3 text-[13px] last:border-b-0 transition-colors duration-150"
      style={{ gridTemplateColumns: cols }}
      onMouseEnter={(ev) => ev.currentTarget.style.background = 'color-mix(in srgb, var(--c-accent) 4%, transparent)'}
      onMouseLeave={(ev) => ev.currentTarget.style.background = ''}
    >
      {children}
    </div>
  )
}

function Cell({ children, className }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', className)}>
      {children}
    </span>
  )
}

function ToggleCard({ icon, label, description, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-bg-1 p-4 transition hover:border-accent-ring hover:bg-accent-soft/30">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
        {icon}
      </span>
      <span className="flex-1">
        <span className="block text-[13px] font-semibold text-fg">{label}</span>
        <span className="mt-0.5 block text-[12px] text-fg-muted">{description}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-5 w-5 cursor-pointer rounded-md border-line-strong accent-[var(--c-accent)]"
      />
    </label>
  )
}

function ActivityIcon({ type }) {
  const isSignup = type === 'user_signup'
  return (
    <div
      className={cn(
        'grid h-8 w-8 shrink-0 place-items-center rounded-md transition-[transform,box-shadow] duration-200 group-hover/act:scale-[1.08] group-hover/act:-rotate-[4deg]',
        isSignup ? 'bg-accent-soft text-accent' : 'bg-success-soft text-success'
      )}
    >
      <Icon name={isSignup ? 'userPlus' : 'video'} size={14} />
    </div>
  )
}
