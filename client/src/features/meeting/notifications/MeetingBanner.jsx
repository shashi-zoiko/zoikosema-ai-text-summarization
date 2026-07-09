import { ArrowUpRight, Info, Shield, ShieldCheck, Sparkles } from 'lucide-react'
import { cn } from '../../../lib/cn'

/**
 * One trust banner on the meeting join screen: icon left, copy centre, CTA
 * right (stacks on mobile). Presentational only — all copy/visibility comes
 * from the resolver (meetingNotificationState). role="status" + aria-label
 * make it announce to screen readers.
 */

const ICONS = { shield: Shield, secure: ShieldCheck, ai: Sparkles }

// tone → lobby token family (amber = warn, green = success, purple = accent).
const TONE = {
  amber: 'bg-[var(--lobby-warn-tint)] text-[var(--lobby-warn-fg)] ring-[var(--lobby-warn-line)]',
  green: 'bg-[var(--lobby-success-tint)] text-[var(--lobby-success-fg)] ring-[var(--lobby-success-line)]',
  purple: 'bg-[var(--lobby-accent-tint)] text-[var(--lobby-accent-fg)] ring-[var(--lobby-accent-line)]',
}
const DOT = {
  green: 'bg-[var(--lobby-success-fg)]',
  amber: 'bg-[var(--lobby-warn-fg)]',
  muted: 'bg-[var(--c-fg-muted)]',
}

export default function MeetingBanner({ banner, onCta }) {
  const Icon = ICONS[banner.icon] || Info
  return (
    <div
      role="status"
      aria-label={banner.ariaLabel}
      className={cn('rounded-2xl p-3.5 ring-1', TONE[banner.tone] || TONE.purple)}
    >
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium leading-relaxed text-[var(--c-fg-dim)]" title={banner.tooltip}>
            {/* Compressed copy on mobile, full copy from sm up. */}
            <span className="sm:hidden">{banner.textShort || banner.text}</span>
            <span className="hidden sm:inline">{banner.text}</span>
          </p>

          {(banner.status || banner.cta) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {banner.status && (
                <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--c-fg-muted)]">
                  <span className={cn('h-1.5 w-1.5 rounded-full', DOT[banner.status.tone] || DOT.muted)} aria-hidden="true" />
                  {banner.status.label}
                </span>
              )}
              {banner.cta && (
                <button
                  type="button"
                  onClick={() => onCta(banner.cta.panel)}
                  className="zk-press ml-auto inline-flex items-center gap-1 border-0 bg-transparent px-0 py-0 text-[12px] font-semibold text-current shadow-none underline-offset-2 transition hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
                >
                  {banner.cta.label} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
