import { useEffect, useState } from 'react'
import Icon from './Icon'
import { cn } from '../lib/cn'

const PLATFORM_LABEL = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
}

/* ─────────────────────────────────────────────────────────────────────────
 * DesktopStatus — small Electron-only sidebar widget showing version +
 * updater status. Companion DesktopStatus.css gone; everything Tailwind.
 * The pulsing dot uses Tailwind's animate-ping for the halo and a static
 * accent fill — visually equivalent to the old dsPulse keyframe but no
 * custom CSS needed.
 * ──────────────────────────────────────────────────────────────────────── */

export default function DesktopStatus() {
  const [version, setVersion] = useState(null)
  const [status, setStatus] = useState('idle')
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.zoiko?.isElectron) return
    let mounted = true
    window.zoiko.getVersion().then((v) => { if (mounted) setVersion(v) }).catch(() => {})
    const off = window.zoiko.onUpdaterStatus(({ status: s, payload }) => {
      setStatus(s)
      setInfo(payload || null)
      if (s !== 'checking') setBusy(false)
    })
    return () => { mounted = false; if (off) off() }
  }, [])

  if (typeof window === 'undefined' || !window.zoiko?.isElectron) return null

  const platform = PLATFORM_LABEL[window.zoiko.platform] || window.zoiko.platform || ''

  const handleCheck = async () => {
    if (busy) return
    setBusy(true)
    setStatus('checking')
    try {
      const r = await window.zoiko.checkForUpdate()
      if (!r?.ok) {
        setStatus('error')
        setInfo({ message: r?.reason === 'dev' ? 'Updates disabled in dev' : r?.reason || 'Check failed' })
        setBusy(false)
      }
    } catch (e) {
      setStatus('error')
      setInfo({ message: String(e?.message || e) })
      setBusy(false)
    }
  }

  const handleRestart = () => window.zoiko.quitAndInstall()

  const statusLine = (() => {
    switch (status) {
      case 'checking':    return { dot: 'pulse', text: 'Checking for updates…' }
      case 'available':   return { dot: 'info',  text: `Downloading ${info?.version || ''}`.trim() }
      case 'progress':    return { dot: 'info',  text: `Downloading… ${info?.percent || 0}%` }
      case 'downloaded':  return { dot: 'ready', text: `v${info?.version || ''} ready — restart to install` }
      case 'not-available': return { dot: 'ok', text: 'You’re up to date' }
      case 'error':       return { dot: 'err', text: info?.message || 'Update check failed' }
      default:            return null
    }
  })()

  return (
    <div
      role="group"
      aria-label="Desktop app"
      className="my-2.5 mb-3 flex flex-col gap-2 rounded-md border border-line bg-bg-1 px-[11px] pt-2.5 pb-[11px] shadow-xs transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-sm"
      style={{ background: 'linear-gradient(180deg, var(--c-bg-1) 0%, var(--c-surface) 100%)' }}
    >
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-fg-muted">
        <span
          className="inline-flex items-center gap-1 rounded-pill border px-[7px] py-px text-[10.5px] font-semibold tracking-[0.02em] text-accent"
          style={{
            background: 'var(--accent-gradient-soft)',
            borderColor: 'color-mix(in srgb, var(--c-accent) 18%, transparent)',
          }}
        >
          <Icon name="sparkle" size={12} />
          Desktop
        </span>
        {version && <span className="font-semibold tabular-nums text-fg-dim">v{version}</span>}
        {platform && <span className="text-fg-muted/70">·</span>}
        {platform && <span className="text-fg-muted">{platform}</span>}
      </div>

      {statusLine && (
        <div className="flex min-h-4 items-center gap-[7px] text-[11.5px] leading-[1.3] text-fg-dim">
          <StatusDot kind={statusLine.dot} />
          <span className="truncate">{statusLine.text}</span>
        </div>
      )}

      <div className="flex gap-1.5">
        {status === 'downloaded' ? (
          <ActionBtn primary onClick={handleRestart}>
            <Icon name="bolt" size={13} />
            Restart to update
          </ActionBtn>
        ) : (
          <ActionBtn
            onClick={handleCheck}
            disabled={busy || status === 'checking' || status === 'progress' || status === 'available'}
          >
            <Icon name="cloudDownload" size={13} />
            {busy || status === 'checking' ? 'Checking…' : 'Check for updates'}
          </ActionBtn>
        )}
      </div>
    </div>
  )
}

/* ────────────────────── pieces ────────────────────── */

const DOT_STYLES = {
  info:  { bg: 'var(--c-accent)',   ring: 'rgba(91,103,242,0.15)' },
  ok:    { bg: 'var(--c-success)',  ring: 'rgba(16,185,129,0.18)' },
  ready: { bg: 'var(--c-accent-3)', ring: 'rgba(214,112,255,0.18)' },
  err:   { bg: 'var(--c-danger)',   ring: 'var(--c-danger-soft)' },
  pulse: { bg: 'var(--c-accent)',   ring: 'rgba(91,103,242,0.4)' },
  '':    { bg: 'color-mix(in srgb, var(--c-fg-muted) 60%, transparent)', ring: 'transparent' },
}

function StatusDot({ kind }) {
  const s = DOT_STYLES[kind] || DOT_STYLES['']
  return (
    <span className="relative inline-grid h-[7px] w-[7px] shrink-0 place-items-center">
      {kind === 'pulse' && (
        <span
          className="absolute inset-0 animate-ping rounded-full opacity-75"
          style={{ background: s.bg }}
        />
      )}
      <span
        className="relative inline-block h-full w-full rounded-full"
        style={{ background: s.bg, boxShadow: `0 0 0 3px ${s.ring}` }}
      />
    </span>
  )
}

function ActionBtn({ children, onClick, disabled, primary }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 !rounded-sm px-2.5 py-[7px] text-[12px] font-semibold transition',
        'disabled:cursor-default disabled:opacity-55',
        primary
          ? '!border-transparent !text-white !shadow-[0_6px_16px_-6px_var(--accent-glow)] enabled:hover:-translate-y-px enabled:hover:!shadow-[0_10px_22px_-8px_var(--accent-glow)]'
          : '!border-line !bg-bg-1 !text-fg-dim enabled:hover:-translate-y-px enabled:hover:!border-line-strong enabled:hover:!bg-bg-2 enabled:hover:!text-fg enabled:hover:!shadow-xs'
      )}
      style={primary ? { background: 'var(--accent-gradient)' } : undefined}
    >
      {children}
    </button>
  )
}
