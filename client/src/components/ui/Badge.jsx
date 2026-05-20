import { cva } from 'class-variance-authority'
import { cn } from '../../lib/cn'

const variants = cva(
  'inline-flex items-center gap-1.5 rounded-full border font-medium tracking-tight whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-[var(--c-bg-3)] text-[var(--c-fg-dim)] border-[var(--c-line)]',
        accent:  'bg-[var(--c-accent-soft)] text-[var(--c-accent)] border-[color-mix(in_srgb,var(--c-accent)_28%,transparent)]',
        success: 'bg-[var(--c-success-soft)] text-[var(--c-success)] border-[color-mix(in_srgb,var(--c-success)_28%,transparent)]',
        warn:    'bg-[var(--c-warn-soft)]    text-[var(--c-warn)]    border-[color-mix(in_srgb,var(--c-warn)_28%,transparent)]',
        danger:  'bg-[var(--c-danger-soft)]  text-[var(--c-danger)]  border-[color-mix(in_srgb,var(--c-danger)_28%,transparent)]',
        live:    'bg-[var(--c-success-soft)] text-[var(--c-success)] border-[color-mix(in_srgb,var(--c-success)_28%,transparent)]',
      },
      size: {
        sm: 'text-[10.5px] px-1.5 py-0.5',
        md: 'text-[11.5px] px-2 py-1',
        lg: 'text-[12.5px] px-2.5 py-1.5',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  }
)

export default function Badge({ tone, size, className, dot, pulse, children, ...props }) {
  return (
    <span className={cn(variants({ tone, size }), className)} {...props}>
      {(dot || pulse) && (
        <span className="relative inline-flex h-1.5 w-1.5">
          {pulse && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-70" />
          )}
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  )
}
