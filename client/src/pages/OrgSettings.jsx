import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import Icon from '../components/Icon'
import Avatar from '../components/Avatar'
import { cn } from '../lib/cn'

/* ─────────────────────────────────────────────────────────────────────────
 * OrgSettings — fully Tailwind. Companion OrgSettings.css removed; the
 * 2026 polish (gradient hero title, lifted section cards on hover,
 * accent shadows) is inlined here. Logic is unchanged.
 * ──────────────────────────────────────────────────────────────────────── */

export default function OrgSettings() {
  const { slug } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [org, setOrg] = useState(null)
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState('')
  const [editName, setEditName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!slug) return
    Promise.all([
      api(`/api/orgs/${slug}`),
      api(`/api/orgs/${slug}/members`),
    ])
      .then(([o, m]) => { setOrg(o); setMembers(m); setEditName(o.name) })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [slug])

  const isOwner = org?.owner_id === user?.id
  const isAdmin = isOwner || members.some(m => m.user_id === user?.id && (m.role === 'owner' || m.role === 'admin'))

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return
    setInviting(true); setInviteMsg('')
    try {
      const res = await api(`/api/orgs/${slug}/invite`, {
        method: 'POST',
        body: { email: inviteEmail.trim(), role: inviteRole },
      })
      setInviteMsg(res.detail)
      setInviteEmail('')
      api(`/api/orgs/${slug}/members`).then(setMembers).catch(() => {})
    } catch (e) {
      setInviteMsg(e.message)
    } finally {
      setInviting(false)
    }
  }

  const removeMember = async (userId) => {
    if (!window.confirm('Remove this member?')) return
    try {
      await api(`/api/orgs/${slug}/members/${userId}`, { method: 'DELETE' })
      setMembers(prev => prev.filter(m => m.user_id !== userId))
    } catch (e) {
      setErr(e.message)
    }
  }

  const saveName = async () => {
    if (!editName.trim() || editName === org?.name) return
    setSaving(true)
    try {
      const updated = await api(`/api/orgs/${slug}`, {
        method: 'PATCH',
        body: { name: editName.trim() },
      })
      setOrg(updated)
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  const deleteOrg = async () => {
    if (!window.confirm('Permanently delete this organization? This cannot be undone.')) return
    try {
      await api(`/api/orgs/${slug}`, { method: 'DELETE' })
      navigate('/')
    } catch (e) {
      setErr(e.message)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[800px] flex-1 overflow-y-auto px-6 py-10 sm:px-12 sm:py-12">
        <div className="grid place-items-center py-20">
          <div className="spinner" />
        </div>
      </div>
    )
  }

  if (!org) {
    return (
      <div className="mx-auto w-full max-w-[800px] flex-1 overflow-y-auto px-6 py-10 sm:px-12 sm:py-12">
        <div className="rounded-[22px] border border-dashed border-line-strong px-6 py-20 text-center text-fg-muted">
          <Icon name="building" size={32} />
          <h2 className="mt-4 mb-2 font-display text-[20px] font-bold tracking-[-0.02em] text-fg">
            Organization not found
          </h2>
          <p className="mb-5">{err || 'This organization does not exist or you do not have access.'}</p>
          <button className="primary" onClick={() => navigate('/')}>Go home</button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[800px] flex-1 overflow-y-auto px-6 py-10 sm:px-12 sm:py-12">
      {/* ============ Hero ============ */}
      <header className="fade-in-up mb-8">
        <button
          className="ghost mb-4 inline-flex items-center gap-1.5 text-[13px] text-fg-muted transition hover:-translate-x-0.5 hover:text-fg"
          onClick={() => navigate('/')}
        >
          <Icon name="arrowLeft" size={16} /> Back
        </button>
        <div className="flex items-center gap-4">
          <div
            className="grid h-14 w-14 shrink-0 place-items-center rounded-lg text-accent shadow-[0_8px_20px_-10px_var(--c-accent-ring)]"
            style={{
              background: 'var(--accent-gradient-soft)',
              border: '1px solid color-mix(in srgb, var(--c-accent) 30%, transparent)',
            }}
          >
            <Icon name="building" size={28} />
          </div>
          <div>
            <h1
              className="m-0 mb-1 font-display text-[26px] font-bold tracking-[-0.035em]"
              style={{
                background: 'linear-gradient(135deg, var(--c-fg) 0%, color-mix(in srgb, var(--c-accent) 65%, var(--c-fg)) 70%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              {org.name}
            </h1>
            <p className="m-0 text-[14px] text-fg-muted">
              {org.member_count} member{org.member_count !== 1 ? 's' : ''} &middot; {org.slug}
            </p>
          </div>
        </div>
      </header>

      {err && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] text-danger">
          <Icon name="close" size={14} /> {err}
        </div>
      )}

      {/* Org name edit */}
      {isAdmin && (
        <Section>
          <SectionTitle>Organization name</SectionTitle>
          <div className="flex gap-2.5">
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="!flex-1 !rounded-[12px] !border-line-strong !bg-bg-1 focus:!border-accent focus:!bg-surface focus:!shadow-[0_0_0_4px_var(--c-accent-ring)]"
            />
            <button
              className="primary"
              disabled={saving || !editName.trim() || editName === org.name}
              onClick={saveName}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Section>
      )}

      {/* Invite member */}
      {isAdmin && (
        <Section>
          <SectionTitle>Invite a member</SectionTitle>
          <div className="flex flex-col gap-2.5 md:flex-row">
            <input
              placeholder="Email address"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              type="email"
              className="!flex-1 !rounded-[12px] !border-line-strong !bg-bg-1 focus:!border-accent focus:!bg-surface focus:!shadow-[0_0_0_4px_var(--c-accent-ring)]"
            />
            <select
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value)}
              className="!w-auto !rounded-[12px] !border-line-strong !bg-bg-1 focus:!border-accent focus:!bg-surface focus:!shadow-[0_0_0_4px_var(--c-accent-ring)]"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button
              className="primary"
              onClick={handleInvite}
              disabled={inviting || !inviteEmail.trim()}
            >
              {inviting ? 'Inviting…' : <><Icon name="userPlus" size={14} /> Invite</>}
            </button>
          </div>
          {inviteMsg && (
            <div className="mt-2.5 text-[13px] text-accent">{inviteMsg}</div>
          )}
        </Section>
      )}

      {/* Members list */}
      <Section>
        <SectionTitle>Members</SectionTitle>
        <div className="flex flex-col gap-1">
          {members.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              isSelf={m.user_id === user?.id}
              canRemove={isAdmin && m.user_id !== org.owner_id && m.user_id !== user?.id}
              onRemove={() => removeMember(m.user_id)}
            />
          ))}
        </div>
      </Section>

      {/* Danger zone */}
      {isOwner && (
        <Section
          tone="danger"
          extraStyle={{
            borderColor: 'color-mix(in srgb, var(--c-danger) 25%, transparent)',
            background: 'color-mix(in srgb, var(--c-danger) 5%, var(--c-bg-1))',
          }}
        >
          <SectionTitle>Danger zone</SectionTitle>
          <p className="m-0 mb-3.5 text-[13px] text-fg-dim">
            Permanently delete this organization and remove all members.
          </p>
          <button
            className="outline inline-flex items-center gap-1.5 !rounded-[12px] !border-[color-mix(in_srgb,var(--c-danger)_35%,transparent)] !bg-bg-1 !text-danger transition hover:-translate-y-px hover:!border-danger hover:!bg-danger-soft hover:!shadow-[0_12px_28px_-10px_color-mix(in_srgb,var(--c-danger)_50%,transparent)]"
            onClick={deleteOrg}
          >
            <Icon name="trash" size={14} /> Delete organization
          </button>
        </Section>
      )}
    </div>
  )
}

/* ────────────────────── pieces ────────────────────── */

function Section({ children, tone, extraStyle }) {
  return (
    <section
      className={cn(
        'group/sec fade-in-up relative isolate mb-4 overflow-hidden rounded-[18px] border border-line bg-bg-1 p-[22px] shadow-sm',
        'transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5'
      )}
      style={extraStyle}
      onMouseEnter={(ev) => {
        ev.currentTarget.style.borderColor = tone === 'danger'
          ? 'color-mix(in srgb, var(--c-danger) 45%, transparent)'
          : 'color-mix(in srgb, var(--c-accent) 26%, var(--c-line-strong))'
        ev.currentTarget.style.boxShadow = tone === 'danger'
          ? '0 22px 48px -20px color-mix(in srgb, var(--c-danger) 30%, transparent)'
          : '0 22px 48px -20px color-mix(in srgb, var(--c-accent) 25%, rgba(0,0,0,0.35))'
      }}
      onMouseLeave={(ev) => {
        ev.currentTarget.style.borderColor = ''
        ev.currentTarget.style.boxShadow = ''
      }}
    >
      {/* Subtle accent wash on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-inherit opacity-0 transition-opacity duration-300 group-hover/sec:opacity-100"
        style={{
          background: tone === 'danger'
            ? 'linear-gradient(135deg, color-mix(in srgb, var(--c-danger) 8%, transparent), transparent 40%)'
            : 'linear-gradient(135deg, color-mix(in srgb, var(--c-accent) 9%, transparent), transparent 40%, color-mix(in srgb, var(--c-accent-3) 7%, transparent))',
          mixBlendMode: 'screen',
        }}
      />
      <div className="relative">{children}</div>
    </section>
  )
}

function SectionTitle({ children }) {
  return (
    <h2 className="m-0 mb-3.5 text-[15px] font-semibold tracking-tight text-fg">
      {children}
    </h2>
  )
}

function MemberRow({ member, isSelf, canRemove, onRemove }) {
  return (
    <div
      className="flex items-center gap-3 rounded-[12px] px-3 py-2.5 transition hover:translate-x-0.5"
      onMouseEnter={(ev) => ev.currentTarget.style.background = 'color-mix(in srgb, var(--c-accent) 5%, transparent)'}
      onMouseLeave={(ev) => ev.currentTarget.style.background = ''}
    >
      <Avatar name={member.user_name || 'U'} color={member.avatar_color} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[14px] font-medium text-fg">
          <span className="truncate">{member.user_name || 'Unknown'}</span>
          {isSelf && <span className="badge sm">You</span>}
        </div>
        <div className="truncate text-[12px] text-fg-muted">{member.user_email}</div>
      </div>
      <span className={cn('badge sm', member.role === 'owner' && 'accent')}>{member.role}</span>
      {canRemove && (
        <button
          className="grid h-[30px] w-[30px] place-items-center !rounded-md !border-transparent !bg-transparent !p-0 text-fg-muted !shadow-none transition hover:!border-danger/20 hover:!bg-danger-soft hover:!text-danger"
          onClick={onRemove}
          title="Remove"
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  )
}
