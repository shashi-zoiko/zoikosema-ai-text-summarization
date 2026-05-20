import { cn } from '../../lib/cn'

export default function Spinner({ size = 'md', className }) {
  const sizes = {
    xs: 'h-3 w-3 border',
    sm: 'h-4 w-4 border-2',
    md: 'h-5 w-5 border-2',
    lg: 'h-8 w-8 border-[3px]',
  }
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        'inline-block animate-spin rounded-full',
        'border-[color-mix(in_srgb,var(--c-fg)_18%,transparent)] border-t-[var(--c-accent)]',
        sizes[size],
        className
      )}
    />
  )
}
