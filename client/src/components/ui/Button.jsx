import { forwardRef } from 'react'
import { motion } from 'framer-motion'
import { cva } from 'class-variance-authority'
import { cn } from '../../lib/cn'

const variants = cva(
  [
    'relative inline-flex select-none items-center justify-center gap-2',
    'font-medium tracking-tight whitespace-nowrap',
    'rounded-xl border outline-none',
    'transition-[background,color,border-color,box-shadow,transform] duration-150',
    'focus-visible:ring-focus disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
    'overflow-hidden',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: [
          'text-white border-transparent',
          'shadow-[0_8px_24px_-8px_var(--c-accent-ring),inset_0_1px_0_rgba(255,255,255,0.18)]',
          'bg-[linear-gradient(135deg,var(--c-accent)_0%,var(--c-accent-2)_55%,var(--c-accent-3)_100%)]',
          'hover:brightness-110 hover:saturate-110',
          'active:scale-[0.985]',
        ].join(' '),
        secondary: [
          'text-[var(--c-fg)] bg-[var(--c-surface-2)] border-[var(--c-line-strong)]',
          'hover:bg-[var(--c-bg-3)] hover:border-[color-mix(in_srgb,var(--c-line-strong)_60%,var(--c-accent))]',
          'active:scale-[0.985]',
        ].join(' '),
        outline: [
          'text-[var(--c-fg)] bg-transparent border-[var(--c-line-strong)]',
          'hover:bg-[var(--c-accent-soft)] hover:border-[var(--c-accent)] hover:text-[var(--c-accent)]',
          'active:scale-[0.985]',
        ].join(' '),
        ghost: [
          'text-[var(--c-fg-dim)] bg-transparent border-transparent shadow-none',
          'hover:bg-[color-mix(in_srgb,var(--c-fg)_6%,transparent)] hover:text-[var(--c-fg)]',
        ].join(' '),
        danger: [
          'text-white border-transparent',
          'bg-[linear-gradient(135deg,#f43f5e,#e11d48)]',
          'shadow-[0_8px_24px_-8px_rgba(244,63,94,0.5),inset_0_1px_0_rgba(255,255,255,0.18)]',
          'hover:brightness-110',
          'active:scale-[0.985]',
        ].join(' '),
        success: [
          'text-white border-transparent',
          'bg-[linear-gradient(135deg,#10b981,#059669)]',
          'shadow-[0_8px_24px_-8px_rgba(16,185,129,0.45)]',
          'hover:brightness-110',
          'active:scale-[0.985]',
        ].join(' '),
      },
      size: {
        xs: 'h-7 px-2.5 text-xs gap-1 rounded-lg',
        sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-[15px] rounded-2xl',
        icon: 'h-10 w-10 p-0',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      block: false,
    },
  }
)

const Button = forwardRef(function Button(
  { variant, size, block, className, children, asMotion = false, loading = false, leftIcon, rightIcon, disabled, ...props },
  ref
) {
  const cls = cn(variants({ variant, size, block }), className)
  const inner = (
    <>
      {variant === 'primary' && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -translate-x-full bg-[linear-gradient(120deg,transparent_30%,rgba(255,255,255,0.30)_50%,transparent_70%)] transition-transform duration-700 ease-out group-hover/btn:translate-x-full"
        />
      )}
      {loading ? (
        <Spinner />
      ) : (
        <>
          {leftIcon}
          {children}
          {rightIcon}
        </>
      )}
    </>
  )

  if (asMotion) {
    return (
      <motion.button
        ref={ref}
        whileTap={{ scale: 0.98 }}
        className={cn('group/btn', cls)}
        disabled={disabled || loading}
        {...props}
      >
        {inner}
      </motion.button>
    )
  }

  return (
    <button ref={ref} className={cn('group/btn', cls)} disabled={disabled || loading} {...props}>
      {inner}
    </button>
  )
})

function Spinner() {
  return (
    <span
      aria-label="Loading"
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
    />
  )
}

export default Button
