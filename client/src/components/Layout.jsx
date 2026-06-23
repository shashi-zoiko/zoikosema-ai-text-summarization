import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BarChart3, ChevronDown, ChevronsUpDown, Home, LogOut, MessageSquareText,
  Settings, ShieldCheck, Users2, Video,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { cn } from '../lib/cn'
import Avatar from './ui/Avatar'
import Logo from './ui/Logo'
import IconButton from './ui/IconButton'
import ThemeToggle from './ui/ThemeToggle'
import NotificationBell from './NotificationBell'
import DesktopStatus from './DesktopStatus'

const NAV = [
  { to: '/',          label: 'Home',      icon: Home,             end: true },
  { to: '/chat',      label: 'Chat',      icon: MessageSquareText },
  { to: '/meet',      label: 'Meet',      icon: Video,            badge: 'Live' },
  { to: '/dashboard', label: 'Analytics', icon: BarChart3 },
]

const SECONDARY = [
  { to: '/admin', label: 'Workspace',  icon: ShieldCheck, role: 'owner' },
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

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="group flex h-11 items-center gap-2.5 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] py-1 pl-1 pr-2.5 transition-colors hover:border-[var(--c-line-strong)] hover:bg-[var(--c-bg-3)]"
      >
        <Avatar name={user.name} color={user.avatar_color} size="sm" presence="online" />
        <span className="hidden flex-col items-start leading-tight sm:flex">
          <span className="max-w-[140px] truncate text-[12.5px] font-semibold tracking-tight">{user.name}</span>
          <span className="max-w-[140px] truncate text-[10.5px] text-[var(--c-fg-muted)]">{user.email}</span>
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-[var(--c-fg-muted)] transition-transform duration-200', open && 'rotate-180')} />
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
                <Avatar name={user.name} color={user.avatar_color} size="md" presence="online" />
                <div className="relative min-w-0">
                  <div className="truncate text-[14px] font-semibold tracking-tight">{user.name}</div>
                  <div className="truncate text-[11.5px] text-[var(--c-fg-muted)]">{user.email}</div>
                </div>
              </div>
              <MenuItem icon={<Settings className="h-4 w-4" />} onClick={() => { setOpen(false); navigate('/admin') }}>
                Workspace settings
              </MenuItem>
              <MenuItem icon={<ShieldCheck className="h-4 w-4" />} onClick={() => { setOpen(false) }}>
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

  return (
    <div className="flex min-h-screen bg-[var(--c-bg)] text-[var(--c-fg)]">
      {/* ===================== Sidebar ===================== */}
      <aside
        className={cn(
          'sticky top-0 z-30 flex h-screen w-[260px] shrink-0 flex-col border-r',
          'border-[var(--c-line)] bg-[color-mix(in_srgb,var(--c-surface)_72%,transparent)]',
          'backdrop-blur-xl'
        )}
        aria-label="Primary"
      >
        <div className="flex items-center justify-between px-4 pt-5 pb-4">
          <NavLink
            to="/"
            aria-label="ZoikoSema home"
            className="rounded-lg outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-(--c-accent-ring)"
          >
            <Logo size={36} withWordmark />
          </NavLink>
        </div>

        <div className="px-3">
          <motion.div
            whileHover={{ y: -1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 22 }}
            className="group/ws cursor-pointer rounded-2xl border border-[var(--c-line)] bg-[var(--c-bg-2)]/60 p-3 transition-colors hover:border-[var(--c-line-strong)] hover:bg-[var(--c-bg-2)]"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl gradient-accent text-[13px] font-bold text-white shadow-[0_4px_14px_-4px_var(--c-accent-ring)]">
                Z
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-semibold leading-tight tracking-tight">Your workspace</div>
                <div className="mt-0.5 truncate text-[10.5px] leading-tight text-[var(--c-fg-muted)]">Free · 3 members</div>
              </div>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-[var(--c-fg-muted)] transition-colors group-hover/ws:text-[var(--c-fg-dim)]" />
            </div>
          </motion.div>
        </div>

        <nav className="mt-4 flex-1 space-y-0.5 px-3" aria-label="Primary navigation">
          <NavSection label="Workspace">
            {NAV.map((item) => (
              <SideLink key={item.to} {...item} />
            ))}
          </NavSection>
          {user && (
            <NavSection label="Manage">
              {SECONDARY.map((item) => (
                <SideLink key={item.to} {...item} />
              ))}
              <SideLink
                key="people"
                to="#"
                label="People"
                icon={Users2}
                disabled
              />
            </NavSection>
          )}
        </nav>

        <div className="space-y-3 border-t border-[var(--c-line)] p-3">
          <DesktopStatus />
          <div className="flex items-center justify-end gap-2 px-1">
            <NotificationBell />
          </div>
        </div>
      </aside>

      {/* ===================== Main column ===================== */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={cn(
            'sticky top-0 z-20 flex h-[60px] items-center gap-3 border-b px-4 sm:px-6',
            'border-[var(--c-line)] bg-[color-mix(in_srgb,var(--c-bg)_70%,transparent)] backdrop-blur-xl'
          )}
        >
          <Breadcrumbs path={location.pathname} />
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <span aria-hidden className="mx-1 hidden h-6 w-px bg-[var(--c-line)] sm:block" />
            <UserMenu />
          </div>
        </header>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function NavSection({ label, children }) {
  return (
    <div className="pb-3">
      <div className="px-2.5 pb-1.5 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--c-fg-muted)]">
        {label}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function SideLink({ to, label, icon: Icon, end, badge, disabled }) {
  if (disabled) {
    return (
      <div className="flex cursor-not-allowed items-center gap-3 rounded-xl px-2.5 py-2 text-[13px] font-medium text-[var(--c-fg-muted)] opacity-60">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--c-bg-3)] [&_svg]:h-4 [&_svg]:w-4">
          <Icon />
        </span>
        <span>{label}</span>
        <span className="ml-auto text-[10px]">Soon</span>
      </div>
    )
  }
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'group/link relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-[13px] font-medium tracking-tight transition',
          isActive
            ? 'bg-[var(--c-accent-soft)] text-[var(--c-fg)]'
            : 'text-[var(--c-fg-dim)] hover:bg-[var(--c-bg-3)] hover:text-[var(--c-fg)]'
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId="side-active"
              className="absolute -left-1 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full gradient-accent"
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            />
          )}
          <span
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-200 group-hover/link:scale-110 group-hover/link:-rotate-3 [&_svg]:h-4 [&_svg]:w-4',
              isActive
                ? 'bg-[color-mix(in_srgb,var(--c-accent)_18%,transparent)] text-[var(--c-accent)] shadow-[0_4px_14px_-6px_var(--c-accent-ring)]'
                : 'bg-[var(--c-bg-3)] text-[var(--c-fg-dim)] group-hover/link:text-[var(--c-fg)]'
            )}
          >
            <Icon />
          </span>
          <span>{label}</span>
          {badge && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[var(--c-success-soft)] px-1.5 py-0.5 text-[9.5px] font-semibold text-[var(--c-success)]">
              <span className="h-1 w-1 rounded-full bg-[var(--c-success)]" /> {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

const PATH_LABELS = {
  '/': 'Home',
  '/chat': 'Chat',
  '/meet': 'Meetings',
  '/dashboard': 'Analytics',
  '/admin': 'Workspace settings',
}

function Breadcrumbs({ path }) {
  const label = PATH_LABELS[path] || (path.startsWith('/chat') ? 'Chat' : path.startsWith('/org') ? 'Organization' : 'Workspace')
  return (
    <div className="flex items-center gap-2 text-[13.5px]">
      <span className="hidden text-[var(--c-fg-muted)] sm:inline">ZoikoSema</span>
      <span className="hidden text-[var(--c-fg-muted)] sm:inline">/</span>
      <span className="font-semibold tracking-tight text-[var(--c-fg)]">{label}</span>
    </div>
  )
}
