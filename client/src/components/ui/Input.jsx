import { forwardRef, useId } from 'react'
import { cn } from '../../lib/cn'

export const Input = forwardRef(function Input(
  { className, error, leftIcon, rightAddon, type = 'text', ...props },
  ref
) {
  return (
    <div className="group/input relative">
      {leftIcon && (
        <>
          <span
            className={cn(
              'pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2',
              'text-[var(--c-fg-muted)] transition-colors duration-150',
              'group-focus-within/input:text-[var(--c-accent)]',
              '[&_svg]:h-[18px] [&_svg]:w-[18px]'
            )}
          >
            {leftIcon}
          </span>
          {/* Thin divider keeps the icon visually separate from the text caret */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-11 top-1/2 h-5 -translate-y-1/2 border-l border-[var(--c-line)] group-focus-within/input:border-[color-mix(in_srgb,var(--c-accent)_45%,transparent)] transition-colors duration-150"
          />
        </>
      )}
      <input
        ref={ref}
        type={type}
        className={cn(
          'w-full h-11 rounded-xl border px-3.5 text-[14px] font-medium text-[var(--c-fg)]',
          'bg-[var(--c-bg-1)] border-[var(--c-line-strong)]',
          'placeholder:text-[var(--c-fg-muted)] placeholder:font-normal',
          'outline-none transition-[border-color,background,box-shadow] duration-150',
          'hover:border-[color-mix(in_srgb,var(--c-line-strong)_60%,var(--c-accent))]',
          'focus:border-[var(--c-accent)] focus:bg-[var(--c-surface-2)]',
          'focus:shadow-[0_0_0_4px_var(--c-accent-ring)]',
          leftIcon && 'pl-[3.25rem]',
          rightAddon && 'pr-12',
          error && 'border-[var(--c-danger)] focus:border-[var(--c-danger)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--c-danger)_30%,transparent)]',
          className
        )}
        {...props}
      />
      {rightAddon && (
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2">{rightAddon}</span>
      )}
    </div>
  )
})

export function Field({ label, hint, error, children, required }) {
  const id = useId()
  const child = children && children.type
    ? { ...children, props: { ...children.props, id, 'aria-invalid': !!error } }
    : children
  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={id} className="block text-[12.5px] font-medium text-[var(--c-fg-dim)] tracking-tight">
          {label} {required && <span className="text-[var(--c-danger)]">*</span>}
        </label>
      )}
      {child}
      {hint && !error && <p className="text-[11.5px] text-[var(--c-fg-muted)]">{hint}</p>}
      {error && <p className="text-[11.5px] text-[var(--c-danger)]">{error}</p>}
    </div>
  )
}

export default Input
