import { Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BarChart3, Calendar, CheckCircle2, ChevronDown, ChevronsUpDown,
  ClipboardCheck, CreditCard, HelpCircle, Home, LogOut, Menu, MessageSquareText,
  PlayCircle, Settings, ShieldCheck, Sparkles, Users, Video, X,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import { cn } from '../lib/cn'

// Total unread chat messages, refreshed on route change / focus and updated
// instantly when the Chat page dispatches 'zoiko:chat-unread' after marking a
// conversation read. ponytail: no global chat WebSocket in Layout — a refetch
// on navigation/focus plus the Chat page's live event covers the real cases
// (the old hardcoded `count: 2` never reflected anything and never cleared).
function useChatUnread() {
  const [count, setCount] = useState(0)
  const location = useLocation()
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const channels = await api('/api/channels')
        if (!cancelled) setCount(channels.reduce((n, c) => n + (c.unread_count || 0), 0))
      } catch { /* leave last known count */ }
    }
    load()
    const onChanged = (e) => {
      if (typeof e.detail === 'number') setCount(e.detail)
      else load()
    }
    window.addEventListener('zoiko:chat-unread', onChanged)
    window.addEventListener('focus', load)
    return () => {
      cancelled = true
      window.removeEventListener('zoiko:chat-unread', onChanged)
      window.removeEventListener('focus', load)
    }
  }, [location.pathname])
  return count
}
import Avatar from './ui/Avatar'
import Logo from './ui/Logo'
import Spinner from './ui/Spinner'
import ThemeToggle from './ui/ThemeToggle'
import NotificationBell from './NotificationBell'
import GlobalSearch from './GlobalSearch'

/* ────────────────────────── nav config ──────────────────────────
 * `to` items are real routes (NavLink, with active state). `action`
 * items point at the closest existing page via onClick and never take an
 * active style — they mirror the mockup's fuller feature list without
 * faking pages that don't exist yet. */
const WORKSPACE_NAV = [
  { key: 'home',       label: 'Home',        icon: Home,              to: '/', end: true, badge: { text: 'Live', tone: 'live' } },
  { key: 'meetings',   label: 'Meetings',    icon: Video,             to: '/scheduled' },
  { key: 'chat',       label: 'Chat',        icon: MessageSquareText, to: '/chat', countTone: 'danger' },
  { key: 'calendar',   label: 'Calendar',    icon: Calendar,          go: '/scheduled' },
  { key: 'summaries',  label: 'AI Summaries', icon: Sparkles,         to: '/ai-summaries' },
  { key: 'actions',    label: 'Actions',     icon: CheckCircle2,      to: '/actions' },
  { key: 'review-queue', label: 'Review Queue', icon: ClipboardCheck, to: '/review-queue' },
  { key: 'recordings', label: 'Recordings',  icon: PlayCircle,        to: '/recordings', badge: { text: 'Soon' } },
]

// NOTE: no 'Workspace' entry here — it used to point at /settings, the exact
// same target as the footer Settings link (and the avatar menu's "Workspace
// settings"), so it was a redundant duplicate route. The footer Settings link
// is the universal entry (Manage is admin-only), so that's the one kept.
const MANAGE_NAV = [
  { key: 'people',    label: 'People',    icon: Users,       to: '/admin' },
  { key: 'security',  label: 'Security',  icon: ShieldCheck, to: '/security' },
  { key: 'analytics', label: 'Analytics', icon: BarChart3,   to: '/analytics', badge: { text: 'Soon' } },
  { key: 'billing',   label: 'Billing',   icon: CreditCard,  to: '/billing' },
]

function UserMenu() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  if (!user) return null

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }
  const role = user.role
    ? user.role.replace(/(^|\s)\S/g, (c) => c.toUpperCase())
    : 'Workspace Owner'

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="group flex h-12 items-center gap-2.5 rounded-xl border border-[var(--c-line)] bg-[var(--c-surface)] py-1 pl-1 pr-2.5 transition-colors hover:border-[var(--c-line-strong)] hover:bg-[var(--c-bg-3)]"
      >
        <Avatar name={user.name} color={user.avatar_color} src={user.show_photo_on_dashboard === false ? undefined : user.avatar_url} size="md" presence="online" />
        <span className="hidden flex-col items-start leading-tight sm:flex">
          <span className="max-w-[160px] truncate text-[13px] font-semibold tracking-tight">{user.name}</span>
          <span className="max-w-[160px] truncate text-[11px] text-[var(--c-fg-muted)]">{role}</span>
        </span>
        <ChevronDown className={cn('h-4 w-4 text-[var(--c-fg-muted)] transition-transform duration-200', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              role="menu"
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.14 }}
              className="absolute right-0 z-50 mt-2 w-[284px] overflow-hidden rounded-2xl border border-[var(--c-line-strong)] bg-[color-mix(in_srgb,var(--c-surface)_96%,transparent)] p-2 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.45)] backdrop-blur-xl"
            >
              <div className="relative mb-1.5 flex items-center gap-3 overflow-hidden rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-3">
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 opacity-70"
                  style={{ background: 'radial-gradient(360px 120px at 0% 0%, var(--c-accent-soft), transparent 75%)' }}
                />
                <Avatar name={user.name} color={user.avatar_color} src={user.show_photo_on_dashboard === false ? undefined : user.avatar_url} size="md" presence="online" />
                <div className="relative min-w-0">
                  <div className="truncate text-[14px] font-semibold tracking-tight">{user.name}</div>
                  <div className="truncate text-[11.5px] text-[var(--c-fg-muted)]">{user.email}</div>
                </div>
              </div>
              <MenuItem icon={<Settings className="h-4 w-4" />} onClick={() => { setOpen(false); navigate('/settings') }}>
                Workspace settings
              </MenuItem>
              <MenuItem icon={<ShieldCheck className="h-4 w-4" />} onClick={() => { setOpen(false); navigate('/security') }}>
                Security &amp; privacy
              </MenuItem>
              <div className="my-1 h-px bg-[var(--c-line)]" />
              <MenuItem icon={<LogOut className="h-4 w-4" />} onClick={handleLogout} danger>
                Sign out
              </MenuItem>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function MenuItem({ icon, children, danger, onClick }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] font-medium transition',
        danger ? 'text-[var(--c-danger)] hover:bg-[var(--c-danger-soft)]' : 'text-[var(--c-fg-dim)] hover:bg-[var(--c-bg-3)] hover:text-[var(--c-fg)]'
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export default function Layout() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [navOpen, setNavOpen] = useState(false)
  const chatUnread = useChatUnread()
  const workspaceNav = WORKSPACE_NAV.map((item) =>
    item.key === 'chat' ? { ...item, count: chatUnread > 0 ? chatUnread : undefined } : item
  )

  useEffect(() => { setNavOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!navOpen) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setNavOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen])

  return (
    <div className="flex min-h-dvh bg-[var(--c-bg)] text-[var(--c-fg)]">
      {navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          aria-hidden
          className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm lg:hidden"
        />
      )}
      {/* ===================== Sidebar ===================== */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] shrink-0 flex-col border-r',
          'border-[var(--c-line)] bg-[var(--c-surface)]',
          'transition-transform duration-300 ease-out',
          'lg:sticky lg:top-0 lg:z-30 lg:h-screen lg:w-[264px] lg:max-w-none lg:translate-x-0',
          navOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'
        )}
        aria-label="Primary"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <NavLink
            to="/"
            aria-label="ZoikoSema home"
            className="rounded-lg outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-(--c-accent-ring)"
          >
            <Logo size={30} withWordmark />
          </NavLink>
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            aria-label="Close menu"
            className="grid h-9 w-9 place-items-center rounded-lg text-[var(--c-fg-muted)] transition hover:bg-[var(--c-bg-3)] hover:text-[var(--c-fg)] lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Workspace switcher */}
        <div className="px-3">
          <button className="group/ws flex w-full items-center gap-3 rounded-2xl border border-[var(--c-line)] bg-[var(--c-bg-2)] p-2.5 text-left transition-colors hover:border-[var(--c-accent-ring)] hover:bg-[var(--c-bg-3)]">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,var(--c-accent),var(--c-accent-2))] text-[13px] font-bold text-white shadow-[0_6px_16px_-6px_var(--c-accent-ring)]">
              YW
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold leading-tight tracking-tight">Your Workspace</span>
              <span className="mt-0.5 block truncate text-[11px] leading-tight text-[var(--c-fg-muted)]">Pro Plan · 8 members</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-[var(--c-fg-muted)] transition-colors group-hover/ws:text-[var(--c-fg-dim)]" />
          </button>
        </div>

        <nav className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto px-3" aria-label="Primary navigation">
          <NavSection label="Workspace">
            {workspaceNav.map((item) => <SideLink key={item.key} {...item} />)}
          </NavSection>
          {/* Manage = workspace admin surface (People/admin, Billing, Security,
              Analytics). Admins only; members reach personal settings via the
              avatar menu. Backend also 403s the admin APIs. */}
          {user?.is_admin && (
            <NavSection label="Manage">
              {MANAGE_NAV.map((item) => <SideLink key={item.key} {...item} />)}
            </NavSection>
          )}
        </nav>

        {/* Footer: status + help / settings */}
        <div className="space-y-0.5 border-t border-[var(--c-line)] px-3 py-3">
          <div className="flex items-center gap-3 rounded-xl px-2.5 py-2">
            <span className="relative flex h-7 w-7 items-center justify-center">
              <span className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-[var(--c-success)] opacity-60" />
              <span className="relative h-2.5 w-2.5 rounded-full bg-[var(--c-success)]" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold leading-tight tracking-tight">Status</span>
              <span className="block truncate text-[11px] leading-tight text-[var(--c-fg-muted)]">All systems operational</span>
            </span>
          </div>
          <SideLink key="help" label="Help & Support" icon={HelpCircle} to="/help-support" statusDot="success" />
          <SideLink key="settings" label="Settings" icon={Settings} to="/settings" />
        </div>
      </aside>

      {/* ===================== Main column ===================== */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={cn(
            'sticky top-0 z-20 flex h-[68px] items-center gap-3 border-b px-4 sm:px-6',
            'border-[var(--c-line)] bg-[color-mix(in_srgb,var(--c-bg)_80%,transparent)] backdrop-blur-xl'
          )}
        >
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
            className="-ml-1 grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[var(--c-fg-dim)] transition hover:bg-[var(--c-bg-3)] hover:text-[var(--c-fg)] lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Search — real quick-search over the user's meetings + chats */}
          <GlobalSearch />

          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <NotificationBell />
            <span aria-hidden className="mx-1 hidden h-7 w-px bg-[var(--c-line)] sm:block" />
            <UserMenu />
          </div>
        </header>

        <main className="flex-1">
          {/* Boundary lives here, not around the whole app, so a lazy page's
              chunk load only spins the content area — the sidebar/header stay
              mounted and navigation feels instant (SPA), not like a reload. */}
          <Suspense fallback={<div className="flex items-center justify-center py-20"><Spinner size="lg" /></div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}

function NavSection({ label, children }) {
  return (
    <div className="pb-3">
      <div className="px-2.5 pb-1.5 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--c-fg-muted)]">
        {label}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

const COUNT_TONES = {
  danger: 'bg-[var(--c-danger)] text-white',
  neutral: 'bg-[var(--c-bg-3)] text-[var(--c-fg-dim)]',
}

/* Row inner content shared by the NavLink and button variants. */
function SideLinkInner({ Icon, label, badge, count, countTone, statusDot, isActive }) {
  return (
    <>
      {isActive && (
        <motion.span
          layoutId="side-active"
          className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--c-accent)]"
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        />
      )}
      <span
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-200 group-hover/link:scale-105 [&_svg]:h-[18px] [&_svg]:w-[18px]',
          isActive
            ? 'bg-[var(--c-accent)] text-white shadow-[0_4px_10px_-3px_var(--c-accent-ring)]'
            : 'bg-transparent text-[var(--c-fg-muted)] group-hover/link:bg-[var(--c-bg-3)] group-hover/link:text-[var(--c-fg)]'
        )}
      >
        <Icon />
      </span>
      <span className="flex-1 truncate">{label}</span>
      {statusDot === 'success' && (
        <span
          className="relative flex h-2 w-2 shrink-0"
          role="img"
          aria-label="All systems operational"
          title="All systems operational"
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--c-success)] opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--c-success)]" />
        </span>
      )}
      {badge && (
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold',
            badge.tone === 'live'
              ? 'bg-[var(--c-success-soft)] text-[var(--c-success)]'
              : 'bg-[var(--c-accent-soft)] text-[var(--c-accent)]'
          )}
        >
          {badge.tone === 'live' && <span className="h-1 w-1 rounded-full bg-[var(--c-success)]" />}
          {badge.text}
        </span>
      )}
      {count != null && (
        <span className={cn('inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10.5px] font-semibold', COUNT_TONES[countTone] || COUNT_TONES.neutral)}>
          {count}
        </span>
      )}
    </>
  )
}

function SideLink({ to, go, label, icon: Icon, end, badge, count, countTone, statusDot }) {
  const navigate = useNavigate()
  const base = 'group/link relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-[13px] tracking-tight transition-colors duration-150'

  if (to) {
    return (
      <NavLink
        to={to}
        end={end}
        className={({ isActive }) =>
          cn(
            base,
            isActive
              ? 'bg-[var(--c-accent-soft)] font-semibold text-[var(--c-fg)]'
              : 'font-medium text-[var(--c-fg-dim)] hover:bg-[var(--c-bg-3)] hover:text-[var(--c-fg)]'
          )
        }
      >
        {({ isActive }) => (
          <SideLinkInner Icon={Icon} label={label} badge={badge} count={count} countTone={countTone} statusDot={statusDot} isActive={isActive} />
        )}
      </NavLink>
    )
  }

  return (
    <button
      type="button"
      onClick={() => go && navigate(go)}
      className={cn(base, 'w-full text-left font-medium text-[var(--c-fg-dim)] hover:bg-[var(--c-bg-3)] hover:text-[var(--c-fg)]')}
    >
      <SideLinkInner Icon={Icon} label={label} badge={badge} count={count} countTone={countTone} statusDot={statusDot} isActive={false} />
    </button>
  )
}
