import { forwardRef } from 'react'
import { cn } from '../../lib/cn'

export const Card = forwardRef(function Card({ className, interactive, glow, children, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        'group/card relative overflow-hidden rounded-2xl border bg-[var(--c-surface)] border-[var(--c-line)]',
        'shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.18)]',
        interactive && 'transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-[color-mix(in_srgb,var(--c-accent)_28%,var(--c-line-strong))] hover:-translate-y-0.5 hover:shadow-[0_22px_48px_-18px_color-mix(in_srgb,var(--c-accent)_30%,rgba(0,0,0,0.45))]',
        className
      )}
      {...props}
    >
      {glow && (
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 right-0 h-48 w-48 rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(closest-side, var(--c-accent-3), transparent)' }}
        />
      )}
      {interactive && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover/card:opacity-100"
          style={{
            background:
              'linear-gradient(135deg, color-mix(in srgb, var(--c-accent) 10%, transparent), transparent 40%, color-mix(in srgb, var(--c-accent-3) 8%, transparent))',
            mixBlendMode: 'screen',
          }}
        />
      )}
      <div className="relative">{children}</div>
    </div>
  )
})

export function CardHeader({ className, ...props }) {
  return <div className={cn('flex items-start gap-3 p-5 pb-3', className)} {...props} />
}
export function CardBody({ className, ...props }) {
  return <div className={cn('px-5 pb-5', className)} {...props} />
}
export function CardFooter({ className, ...props }) {
  return <div className={cn('flex items-center justify-between gap-2 border-t px-5 py-3 border-[var(--c-line)]', className)} {...props} />
}
export function CardTitle({ className, ...props }) {
  return <h3 className={cn('text-base font-semibold text-[var(--c-fg)]', className)} {...props} />
}
export function CardDescription({ className, ...props }) {
  return <p className={cn('text-[13px] text-[var(--c-fg-muted)] leading-relaxed', className)} {...props} />
}

export default Card
