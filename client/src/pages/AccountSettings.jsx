import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  AlertTriangle, AtSign, Briefcase, Building2, Check, ChevronRight, Eye, FileText,
  Lock, LogOut, Mail, Palette, Save, Settings, Shield, ShieldCheck, Trash2, Upload, User,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme, THEMES } from '../theme/ThemeProvider'
import Avatar from '../components/ui/Avatar'
import AvatarCropModal from '../components/AvatarCropModal'
import { cn } from '../lib/cn'

/* Workspace settings + Security & privacy. One component, two sections, driven
 * by the `section` prop from the route. Everything is backed by real
 * /api/auth/* endpoints via AuthContext — no faked state. */
export default function AccountSettings({ section = 'workspace' }) {
  const { user } = useAuth()
  if (!user) return null

  return (
    <div className="mx-auto w-full max-w-[820px] px-6 py-10 sm:px-10">
      <header className="mb-6">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-[var(--c-accent-soft)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--c-accent)]">
          {section === 'security' ? <ShieldCheck className="h-3.5 w-3.5" /> : <Settings className="h-3.5 w-3.5" />}
          {section === 'security' ? 'Security' : 'Settings'}
        </div>
        <h1 className="text-[26px] font-bold tracking-[-0.03em] text-[var(--c-fg)]">
          {section === 'security' ? 'Security & privacy' : 'Workspace settings'}
        </h1>
        <p className="mt-1 text-[14px] text-[var(--c-fg-muted)]">
          {section === 'security'
            ? 'Manage your password, sessions, and account.'
            : 'Manage your profile and how the workspace looks.'}
        </p>
      </header>

      {/* Tabs */}
      <div className="mb-7 flex gap-1 border-b border-[var(--c-line)]">
        <Tab to="/settings" icon={Settings}>Workspace settings</Tab>
        <Tab to="/security" icon={Shield}>Security &amp; privacy</Tab>
      </div>

      {section === 'security' ? <SecuritySection /> : <WorkspaceSection />}
    </div>
  )
}

function Tab({ to, icon: Icon, children }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        cn(
          '-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-[13.5px] font-medium transition-colors',
          isActive
            ? 'border-[var(--c-accent)] text-[var(--c-fg)]'
            : 'border-transparent text-[var(--c-fg-muted)] hover:text-[var(--c-fg)]'
        )
      }
    >
      <Icon className="h-4 w-4" />
      {children}
    </NavLink>
  )
}

/* ─────────────────────────── Workspace ─────────────────────────── */

function WorkspaceSection() {
  const { user, updateProfile, uploadAvatar, removeAvatar } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const [name, setName] = useState(user.name || '')
  const [jobTitle, setJobTitle] = useState(user.job_title || '')
  const [pronouns, setPronouns] = useState(user.pronouns || '')
  const [bio, setBio] = useState(user.bio || '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null) // { ok, text }
  const [photoBusy, setPhotoBusy] = useState(false)
  const [cropFile, setCropFile] = useState(null)
  const fileRef = useRef(null)

  const onPickPhoto = (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (file) setCropFile(file) // open the crop/zoom step before uploading
  }

  const onCropDone = async (blob) => {
    setCropFile(null)
    setPhotoBusy(true); setMsg(null)
    try {
      await uploadAvatar(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }))
      setMsg({ ok: true, text: 'Photo updated.' })
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    } finally {
      setPhotoBusy(false)
    }
  }

  const setVisibility = async (key, val) => {
    setMsg(null)
    try {
      await updateProfile({ [key]: val })
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    }
  }

  const onRemovePhoto = async () => {
    setPhotoBusy(true); setMsg(null)
    try {
      await removeAvatar()
      setMsg({ ok: true, text: 'Photo removed.' })
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    } finally {
      setPhotoBusy(false)
    }
  }

  const dirty = !!name.trim() && (
    name.trim() !== user.name ||
    jobTitle !== (user.job_title || '') ||
    pronouns !== (user.pronouns || '') ||
    bio !== (user.bio || '')
  )
  const role = user.role
    ? user.role.replace(/(^|\s)\S/g, (c) => c.toUpperCase())
    : 'Workspace Owner'

  const save = async () => {
    if (!dirty) return
    setSaving(true); setMsg(null)
    try {
      await updateProfile({
        name: name.trim(),
        job_title: jobTitle.trim(),
        pronouns: pronouns.trim(),
        bio: bio.trim(),
      })
      setMsg({ ok: true, text: 'Profile updated.' })
    } catch (e) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card title="Profile" desc="Your name and identity across the workspace.">
        <div className="mb-5 flex items-center gap-4">
          <Avatar name={user.name} color={user.avatar_color} src={user.avatar_url} size="lg" presence="online" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold text-[var(--c-fg)]">{user.name}</div>
            <div className="truncate text-[12.5px] text-[var(--c-fg-muted)]">{role}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={onPickPhoto} />
              <button
                type="button"
                disabled={photoBusy}
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 !rounded-[9px] !border-[var(--c-line-strong)] !bg-[var(--c-bg-1)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--c-fg-dim)] disabled:opacity-60"
              >
                <Upload className="h-3.5 w-3.5" /> {photoBusy ? 'Uploading…' : user.avatar_url ? 'Change photo' : 'Upload photo'}
              </button>
              {user.avatar_url && (
                <button
                  type="button"
                  disabled={photoBusy}
                  onClick={onRemovePhoto}
                  className="inline-flex items-center gap-1.5 !rounded-[9px] !border-[color-mix(in_srgb,var(--c-danger)_35%,transparent)] !bg-[var(--c-bg-1)] px-3 py-1.5 text-[12.5px] font-medium !text-[var(--c-danger)] disabled:opacity-60"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              )}
            </div>
          </div>
        </div>

        <Field label="Display name" icon={User}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            className="w-full bg-transparent text-[14px] text-[var(--c-fg)] outline-none placeholder:text-[var(--c-fg-muted)]"
            placeholder="Your name"
          />
        </Field>

        <Field label="Email" icon={Mail} hint="Contact support to change your email.">
          <input
            value={user.email}
            readOnly
            className="w-full cursor-not-allowed bg-transparent text-[14px] text-[var(--c-fg-muted)] outline-none"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Job title" icon={Briefcase}>
            <input
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              maxLength={120}
              className="w-full bg-transparent text-[14px] text-[var(--c-fg)] outline-none placeholder:text-[var(--c-fg-muted)]"
              placeholder="e.g. Product Designer"
            />
          </Field>
          <Field label="Pronouns" icon={AtSign}>
            <input
              value={pronouns}
              onChange={(e) => setPronouns(e.target.value)}
              maxLength={40}
              className="w-full bg-transparent text-[14px] text-[var(--c-fg)] outline-none placeholder:text-[var(--c-fg-muted)]"
              placeholder="e.g. she/her"
            />
          </Field>
        </div>

        <Field label="Bio" icon={FileText} hint={`${bio.length}/300`}>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 300))}
            rows={3}
            className="w-full resize-none bg-transparent text-[14px] text-[var(--c-fg)] outline-none placeholder:text-[var(--c-fg-muted)]"
            placeholder="A short line about you, shown on your profile."
          />
        </Field>

        <div className="mt-4 flex items-center gap-3">
          <button
            className="primary !rounded-[10px]"
            disabled={!dirty || saving}
            onClick={save}
          >
            <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save changes'}
          </button>
          {msg && (
            <span className={cn('inline-flex items-center gap-1.5 text-[13px]', msg.ok ? 'text-[var(--c-accent)]' : 'text-[var(--c-danger)]')}>
              {msg.ok && <Check className="h-4 w-4" />} {msg.text}
            </span>
          )}
        </div>
      </Card>

      <Card title="Photo visibility" desc="Choose where your profile photo appears. When off, that place shows your initials instead.">
        <div className="space-y-2.5">
          <ToggleRow
            label="Show my photo in meetings"
            hint="Your camera-off tile uses your photo instead of initials."
            checked={user.show_photo_in_meetings !== false}
            onChange={(v) => setVisibility('show_photo_in_meetings', v)}
          />
          <ToggleRow
            label="Show my photo on the dashboard"
            hint="Applies to the header and account menu."
            checked={user.show_photo_on_dashboard !== false}
            onChange={(v) => setVisibility('show_photo_on_dashboard', v)}
          />
        </div>
      </Card>

      <Card title="Appearance" desc="Choose how ZoikoSema looks on this device.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {THEMES.map((t) => {
            const active = t.id === theme
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={cn(
                  'flex items-center gap-2.5 !rounded-[10px] border px-3 py-3 text-left text-[13px] font-medium transition-colors',
                  active
                    ? '!border-[var(--c-accent)] bg-[var(--c-accent-soft)] text-[var(--c-fg)]'
                    : '!border-[var(--c-line-strong)] bg-[var(--c-bg-1)] text-[var(--c-fg-dim)] hover:!border-[var(--c-line-strong)]'
                )}
              >
                <Palette className="h-4 w-4 shrink-0 text-[var(--c-accent)]" />
                <span className="truncate">{t.label}</span>
                {active && <Check className="ml-auto h-4 w-4 shrink-0 text-[var(--c-accent)]" />}
              </button>
            )
          })}
        </div>
      </Card>

      <Card title="Workspace" desc="Members, invites, roles and organization settings.">
        <button
          onClick={() => navigate('/admin')}
          className="flex w-full items-center gap-3 !rounded-[10px] !border-[var(--c-line-strong)] !bg-[var(--c-bg-1)] px-4 py-3 text-left"
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--c-accent-soft)] text-[var(--c-accent)]">
            <Building2 className="h-4.5 w-4.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-semibold text-[var(--c-fg)]">Manage workspace</span>
            <span className="block text-[12px] text-[var(--c-fg-muted)]">Open the admin panel</span>
          </span>
          <ChevronRight className="h-4.5 w-4.5 text-[var(--c-fg-muted)]" />
        </button>
      </Card>

      {cropFile && (
        <AvatarCropModal file={cropFile} onCancel={() => setCropFile(null)} onDone={onCropDone} />
      )}
    </div>
  )
}

/* ─────────────────────────── Security ─────────────────────────── */

function SecuritySection() {
  const { changePassword, deleteAccount, logout } = useAuth()
  const navigate = useNavigate()
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  const valid = cur && next.length >= 8 && next === confirm

  const submit = async (e) => {
    e.preventDefault()
    if (!valid) return
    setSaving(true); setMsg(null)
    try {
      await changePassword(cur, next)
      setMsg({ ok: true, text: 'Password changed successfully.' })
      setCur(''); setNext(''); setConfirm('')
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    } finally {
      setSaving(false)
    }
  }

  const signOut = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const remove = async () => {
    if (!window.confirm('Permanently delete your account? This cannot be undone.')) return
    try {
      await deleteAccount()
      navigate('/login', { replace: true })
    } catch (e) {
      setMsg({ ok: false, text: e.message })
    }
  }

  return (
    <div className="space-y-4">
      <Card title="Change password" desc="Use at least 8 characters.">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Current password" icon={Lock}>
            <input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)}
              className="w-full bg-transparent text-[14px] text-[var(--c-fg)] outline-none" />
          </Field>
          <Field label="New password" icon={Lock}>
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)}
              className="w-full bg-transparent text-[14px] text-[var(--c-fg)] outline-none" />
          </Field>
          <Field label="Confirm new password" icon={Lock}
            hint={confirm && next !== confirm ? 'Passwords do not match.' : undefined} hintTone="danger">
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              className="w-full bg-transparent text-[14px] text-[var(--c-fg)] outline-none" />
          </Field>
          <div className="flex items-center gap-3 pt-1">
            <button type="submit" className="primary !rounded-[10px]" disabled={!valid || saving}>
              <Shield className="h-4 w-4" /> {saving ? 'Updating…' : 'Update password'}
            </button>
            {msg && (
              <span className={cn('inline-flex items-center gap-1.5 text-[13px]', msg.ok ? 'text-[var(--c-accent)]' : 'text-[var(--c-danger)]')}>
                {msg.ok && <Check className="h-4 w-4" />} {msg.text}
              </span>
            )}
          </div>
        </form>
      </Card>

      <Card title="Sessions" desc="Sign out of this device.">
        <button
          onClick={signOut}
          className="inline-flex items-center gap-2 !rounded-[10px] !border-[var(--c-line-strong)] !bg-[var(--c-bg-1)] px-4 py-2.5 text-[13.5px] font-medium text-[var(--c-fg-dim)]"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </Card>

      <Card
        title="Danger zone"
        desc="Permanently delete your account and all associated data."
        tone="danger"
      >
        <button
          onClick={remove}
          className="inline-flex items-center gap-2 !rounded-[10px] !border-[color-mix(in_srgb,var(--c-danger)_35%,transparent)] !bg-[var(--c-bg-1)] px-4 py-2.5 text-[13.5px] font-medium !text-[var(--c-danger)] hover:!bg-[var(--c-danger-soft)]"
        >
          <Trash2 className="h-4 w-4" /> Delete account
        </button>
      </Card>
    </div>
  )
}

/* ─────────────────────────── pieces ─────────────────────────── */

function Card({ title, desc, tone, children }) {
  return (
    <section
      className={cn(
        'rounded-[14px] border bg-[var(--c-bg-1)] p-5 shadow-sm sm:p-6',
        tone === 'danger'
          ? 'border-[color-mix(in_srgb,var(--c-danger)_25%,transparent)]'
          : 'border-[var(--c-line)]'
      )}
    >
      <div className="mb-4 flex items-start gap-2">
        {tone === 'danger' && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--c-danger)]" />}
        <div>
          <h2 className={cn('text-[15px] font-semibold tracking-tight', tone === 'danger' ? 'text-[var(--c-danger)]' : 'text-[var(--c-fg)]')}>
            {title}
          </h2>
          {desc && <p className="mt-0.5 text-[13px] text-[var(--c-fg-muted)]">{desc}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

function ToggleRow({ label, hint, checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 !rounded-[10px] border border-[var(--c-line-strong)] bg-[var(--c-bg-1)] px-3.5 py-3 text-left transition-colors hover:border-[var(--c-accent)]"
    >
      <Eye className="h-4 w-4 shrink-0 text-[var(--c-fg-muted)]" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium text-[var(--c-fg)]">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] leading-snug text-[var(--c-fg-muted)]">{hint}</span>}
      </span>
      <span className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-[var(--c-accent)]' : 'bg-[var(--c-line-strong)]')}>
        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </span>
    </button>
  )
}

function Field({ label, icon: Icon, hint, hintTone, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-[var(--c-fg-dim)]">{label}</span>
      <span className="flex items-center gap-2.5 rounded-[10px] border border-[var(--c-line-strong)] bg-[var(--c-bg-1)] px-3.5 py-2.5 transition-colors focus-within:border-[var(--c-accent)] focus-within:shadow-[0_0_0_3px_var(--c-accent-ring)]">
        {Icon && <Icon className="h-4 w-4 shrink-0 text-[var(--c-fg-muted)]" />}
        {children}
      </span>
      {hint && (
        <span className={cn('mt-1 block text-[11.5px]', hintTone === 'danger' ? 'text-[var(--c-danger)]' : 'text-[var(--c-fg-muted)]')}>
          {hint}
        </span>
      )}
    </label>
  )
}
