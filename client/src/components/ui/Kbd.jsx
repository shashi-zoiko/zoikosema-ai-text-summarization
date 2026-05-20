import { cn } from '../../lib/cn'

export default function Kbd({ children, className }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-[var(--c-line)] bg-[var(--c-bg-3)]',
        'px-1.5 font-mono text-[10.5px] font-medium text-[var(--c-fg-muted)] shadow-[0_1px_0_0_var(--c-line)]',
        className
      )}
    >
      {children}
    </kbd>
  )
}
