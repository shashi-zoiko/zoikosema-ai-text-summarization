import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bot, BarChart3, ChevronDown, Command, Home, LogOut, MessageSquareText,
  Moon, Search, Settings, ShieldCheck, Sparkles, Sun, Users2, Video,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme, THEMES } from '../theme/ThemeProvider'
import { cn } from '../lib/cn'
import Avatar from './ui/Avatar'
import Logo from './ui/Logo'
import IconButton from './ui/IconButton'
import Kbd from './ui/Kbd'
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

function ThemeMenu() {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const current = THEMES.find((t) => t.id === theme) || THEMES[0]
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 items-center gap-2 rounded-lg border border-[var(--c-line)] bg-[var(--c-bg-2)] px-2.5 text-[12.5px] font-medium text-[var(--c-fg-dim)] transition hover:border-[var(--c-line-strong)] hover:text-[var(--c-fg)]"
      >
        {current.mode === 'dark' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">{current.label}</span>
        <ChevronDown className="h-3 w-3 opacity-70" />
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
              className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-[var(--c-line-strong)] bg-[color-mix(in_srgb,var(--c-surface)_92%,transparent)] p-2 shadow-2xl backdrop-blur-xl"
            >
              <div className="px-2 pb-2 pt-1">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--c-fg-muted)]">Appearance</div>
              </div>
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  role="menuitemradio"
                  aria-checked={t.id === theme}
                  onClick={() => { setTheme(t.id); setOpen(false) }}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition',
                    t.id === theme ? 'bg-[var(--c-accent-soft)]' : 'hover:bg-white/5'
                  )}
                >
                  <span
                    aria-hidden
                    className="h-8 w-8 shrink-0 rounded-lg border border-white/10"
                    style={{
                      background:
                        t.id === 'midnight'
                          ? 'linear-gradient(135deg, #0f121b, #6366f1)'
                          : 'linear-gradient(135deg, #ffffff, #eef0ff)',
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className={cn('text-[13px] font-semibold tracking-tight', t.id === theme ? 'text-[var(--c-accent)]' : 'text-[var(--c-fg)]')}>
                      {t.label}
                    </div>
                    <div className="text-[11.5px] text-[var(--c-fg-muted)] leading-tight">{t.desc}</div>
                  </div>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

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
        className="flex items-center gap-2.5 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] py-1 pl-1 pr-2.5 transition hover:border-[var(--c-line-strong)]"
      >
        <Avatar name={user.name} color={user.avatar_color} size="sm" presence="online" />
        <span className="hidden flex-col items-start leading-tight sm:flex">
          <span className="max-w-[140px] truncate text-[12.5px] font-semibold tracking-tight">{user.name}</span>
          <span className="max-w-[140px] truncate text-[10.5px] text-[var(--c-fg-muted)]">{user.email}</span>
        </span>
        <ChevronDown className="h-3 w-3 opacity-70" />
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
              className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-[var(--c-line-strong)] bg-[color-mix(in_srgb,var(--c-surface)_92%,transparent)] p-2 shadow-2xl backdrop-blur-xl"
            >
              <div className="flex items-center gap-3 rounded-xl bg-white/[0.02] p-3">
                <Avatar name={user.name} color={user.avatar_color} size="md" />
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold tracking-tight">{user.name}</div>
                  <div className="truncate text-[11.5px] text-[var(--c-fg-muted)]">{user.email}</div>
                </div>
              </div>
              <div className="my-1 h-px bg-[var(--c-line)]" />
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
        danger ? 'text-[var(--c-danger)] hover:bg-[var(--c-danger-soft)]' : 'text-[var(--c-fg-dim)] hover:bg-white/5 hover:text-[var(--c-fg)]'
      )}
    >
      {icon}
      {children}
    </button>
  )
}

function CommandBar() {
  return (
    <button
      className="group hidden h-9 items-center gap-2 rounded-lg border border-[var(--c-line)] bg-[var(--c-bg-2)] px-3 text-[12.5px] text-[var(--c-fg-muted)] transition hover:border-[var(--c-line-strong)] hover:text-[var(--c-fg-dim)] md:flex md:w-[260px] xl:w-[340px]"
      onClick={() => {}}
    >
      <Search className="h-3.5 w-3.5" />
      <span>Search meetings, channels, people…</span>
      <span className="ml-auto inline-flex items-center gap-1">
        <Kbd>⌘</Kbd><Kbd>K</Kbd>
      </span>
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
          <Logo size={36} withWordmark />
        </div>

        <div className="px-3">
          <motion.div
            whileHover={{ y: -1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 22 }}
            className="group/ws cursor-pointer rounded-2xl border border-[var(--c-line)] bg-[var(--c-bg-2)]/60 p-3 transition-colors hover:border-[var(--c-line-strong)] hover:bg-[var(--c-bg-2)]"
          >
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg gradient-accent text-white shadow-[0_4px_14px_-4px_var(--c-accent-ring)] transition-transform duration-200 group-hover/ws:scale-110 group-hover/ws:rotate-3">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-semibold tracking-tight">Your workspace</div>
                <div className="truncate text-[10.5px] text-[var(--c-fg-muted)]">Free · 3 members</div>
              </div>
              <button
                className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--c-fg-muted)] transition-all duration-150 hover:bg-white/5 hover:text-[var(--c-fg)] group-hover/ws:translate-y-0.5"
                title="Switch workspace"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.div>
        </div>

        <nav className="mt-4 flex-1 space-y-0.5 px-3" aria-label="Primary navigation">
          <NavSection label="Workspace">
            {NAV.map((item) => (
              <SideLink key={item.to} {...item} />
            ))}
          </NavSection>
          <NavSection label="AI">
            <button
              className="group/ai relative flex w-full items-center gap-3 overflow-hidden rounded-xl px-2.5 py-2 text-left text-[13px] font-medium text-[var(--c-fg-dim)] transition hover:bg-white/5 hover:text-[var(--c-fg)]"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 -translate-x-full bg-[linear-gradient(120deg,transparent_30%,color-mix(in_srgb,var(--c-accent)_22%,transparent)_50%,transparent_70%)] transition-transform duration-700 ease-out group-hover/ai:translate-x-full"
              />
              <span className="flex h-7 w-7 items-center justify-center rounded-lg gradient-accent text-white shadow-[0_4px_14px_-4px_var(--c-accent-ring)] transition-transform duration-200 group-hover/ai:scale-110 group-hover/ai:rotate-3">
                <Bot className="h-4 w-4" />
              </span>
              <span>Ask AI</span>
              <span className="ml-auto"><Kbd>⌘ J</Kbd></span>
            </button>
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
          <div className="flex items-center justify-between gap-2 px-1">
            <ThemeMenu />
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
          <div className="ml-auto flex items-center gap-2.5">
            <CommandBar />
            <ThemeToggle />
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
            : 'text-[var(--c-fg-dim)] hover:bg-white/5 hover:text-[var(--c-fg)]'
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
