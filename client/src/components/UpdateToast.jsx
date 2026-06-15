import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { cn } from '../lib/cn'

const AUTO_DISMISS_MS = 4500

/* ─────────────────────────────────────────────────────────────────────────
 * UpdateToast — Electron auto-updater status pill.
 * Companion UpdateToast.css gone; everything's Tailwind reading off the
 * design tokens. Logic unchanged.
 * ──────────────────────────────────────────────────────────────────────── */

const TONE_BORDER = {
  ok:    'border-[color-mix(in_srgb,#10b981_35%,transparent)]',
  ready: 'border-[color-mix(in_srgb,#15936b_35%,transparent)]',
  err:   'border-[color-mix(in_srgb,#ef4444_35%,transparent)]',
  info:  'border-[color-mix(in_srgb,var(--c-accent)_35%,transparent)]',
}

const TONE_ICON_BG = {
  ok:    'linear-gradient(135deg, #10b981, #059669)',
  ready: 'linear-gradient(135deg, #15936b, #34d399)',
  err:   'linear-gradient(135deg, #ef4444, #dc2626)',
  info:  'var(--accent-gradient)',
  '':    'var(--accent-gradient)',
}

const TONE_ICON_SHADOW = {
  ok:    '0 6px 18px -6px rgba(16,185,129,0.45)',
  ready: '0 6px 18px -6px rgba(214,112,255,0.45)',
  err:   '0 6px 18px -6px var(--danger-glow)',
  info:  '0 6px 18px -6px var(--accent-glow)',
  '':    '0 6px 18px -6px var(--accent-glow)',
}

export default function UpdateToast() {
  const [state, setState] = useState(null)
  const [dismissed, setDismissed] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.zoiko?.isElectron) return
    const off = window.zoiko.onUpdaterStatus(({ status, payload }) => {
      setDismissed(false)
      setState({ status, payload })
    })
    return off
  }, [])

  useEffect(() => {
    if (!state) return
    clearTimeout(timerRef.current)
    const { status } = state
    if (status === 'not-available' || status === 'error') {
      timerRef.current = setTimeout(() => setDismissed(true), AUTO_DISMISS_MS)
    }
    return () => clearTimeout(timerRef.current)
  }, [state])

  if (!state || dismissed) return null
  const { status, payload } = state

  const close = () => setDismissed(true)

  let iconName = 'sparkle'
  let tone = ''
  let title = ''
  let sub = null
  let progress = null
  let action = null

  if (status === 'checking') {
    iconName = 'cloudDownload'
    title = 'Checking for updates'
    sub = 'Looking for a newer version of ZoikoSema…'
  } else if (status === 'available') {
    iconName = 'sparkle'; tone = 'info'
    title = 'Update available'
    sub = `Downloading ZoikoSema ${payload?.version || ''}`.trim() + '…'
  } else if (status === 'progress') {
    iconName = 'bolt'; tone = 'info'
    title = 'Downloading update'
    sub = payload?.percent != null ? `${payload.percent}% complete` : null
    progress = payload?.percent || 0
  } else if (status === 'downloaded') {
    iconName = 'check'; tone = 'ready'
    title = 'Update ready'
    sub = `ZoikoSema ${payload?.version || ''} will install on restart.`
    action = (
      <button className="primary sm" onClick={() => window.zoiko?.quitAndInstall()}>
        Restart
      </button>
    )
  } else if (status === 'not-available') {
    iconName = 'check'; tone = 'ok'
    title = 'You’re up to date'
    sub = 'Running the latest version of ZoikoSema.'
  } else if (status === 'error') {
    iconName = 'shield'; tone = 'err'
    title = 'Update check failed'
    sub = payload?.message || 'Please try again later.'
  } else {
    return null
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fade-in-up fixed bottom-5 right-5 z-[1000] flex max-w-[340px] items-center gap-3',
        'rounded-md border bg-white/92 py-3.5 pl-3.5 pr-[34px] text-fg shadow-xl backdrop-blur-md backdrop-saturate-150',
        tone ? TONE_BORDER[tone] : 'border-line'
      )}
    >
      <div
        className="grid h-8 w-8 shrink-0 place-items-center rounded-sm text-white transition-[background,box-shadow] duration-200"
        style={{
          background: TONE_ICON_BG[tone],
          boxShadow: TONE_ICON_SHADOW[tone],
        }}
      >
        <Icon name={iconName} size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold tracking-[-0.01em]">{title}</div>
        {sub && <div className="mt-0.5 text-[12px] text-fg-muted">{sub}</div>}
        {progress != null && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-[2px] bg-bg-3">
            <div
              className="h-full transition-[width] duration-200"
              style={{ width: `${progress}%`, background: 'var(--accent-gradient)' }}
            />
          </div>
        )}
      </div>
      {action}
      <button
        onClick={close}
        aria-label="Dismiss"
        className="absolute right-1.5 top-1.5 grid h-[22px] w-[22px] place-items-center !rounded-md !border-0 !bg-transparent !p-0 text-fg-muted !shadow-none transition hover:!bg-[color-mix(in_srgb,var(--c-fg)_6%,transparent)] hover:!text-fg"
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}
