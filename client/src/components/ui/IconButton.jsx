import { forwardRef } from 'react'
import { motion } from 'framer-motion'
import { cva } from 'class-variance-authority'
import { cn } from '../../lib/cn'
import Tooltip from './Tooltip'

const variants = cva(
  [
    'group/icbtn relative inline-flex items-center justify-center select-none overflow-hidden',
    'border outline-none',
    'transition-[background,color,border-color,box-shadow,transform,filter] duration-200 ease-out',
    'focus-visible:ring-focus disabled:opacity-50 disabled:cursor-not-allowed',
    'will-change-transform',
  ].join(' '),
  {
    variants: {
      variant: {
        glass: [
          'text-[var(--c-fg)] border-[var(--c-line)]',
          'bg-[color-mix(in_srgb,var(--c-surface)_75%,transparent)]',
          'backdrop-blur-md backdrop-saturate-150',
          'shadow-[0_2px_8px_-4px_color-mix(in_srgb,var(--c-fg)_18%,transparent)]',
          'hover:bg-[var(--c-accent-soft)] hover:text-[var(--c-accent)]',
          'hover:border-[color-mix(in_srgb,var(--c-accent)_40%,var(--c-line-strong))]',
          'hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-8px_var(--c-accent-ring)]',
          'active:scale-95 active:translate-y-0',
        ].join(' '),
        solid: [
          'text-[var(--c-fg)] bg-[var(--c-surface-2)] border-[var(--c-line)]',
          'hover:bg-[var(--c-accent-soft)] hover:text-[var(--c-accent)] hover:border-[color-mix(in_srgb,var(--c-accent)_40%,var(--c-line-strong))]',
          'hover:-translate-y-0.5 active:scale-95',
        ].join(' '),
        ghost: [
          'text-[var(--c-fg-dim)] bg-transparent border-transparent',
          'hover:bg-[color-mix(in_srgb,var(--c-fg)_8%,transparent)] hover:text-[var(--c-fg)]',
          'active:scale-95',
        ].join(' '),
        accent: [
          'text-white border-transparent',
          'bg-[linear-gradient(135deg,var(--c-accent)_0%,var(--c-accent-2)_100%)]',
          'shadow-[0_6px_18px_-6px_var(--c-accent-ring)]',
          'hover:brightness-110 hover:saturate-110 hover:-translate-y-0.5',
          'hover:shadow-[0_14px_32px_-8px_var(--c-accent-ring)]',
          'active:scale-95',
        ].join(' '),
        danger: [
          'text-white border-transparent',
          'bg-[linear-gradient(135deg,#f43f5e,#e11d48)]',
          'shadow-[0_8px_24px_-6px_rgba(244,63,94,0.55),0_0_0_4px_rgba(244,63,94,0.18)]',
          'hover:brightness-110 hover:-translate-y-0.5 hover:shadow-[0_14px_36px_-8px_rgba(244,63,94,0.70),0_0_0_5px_rgba(244,63,94,0.24)]',
          'active:scale-95',
        ].join(' '),
        toggleOff: [
          'text-[var(--c-fg)] border-[var(--c-line)]',
          'bg-[color-mix(in_srgb,var(--c-surface)_75%,transparent)]',
          'backdrop-blur-md',
          'hover:bg-[var(--c-accent-soft)] hover:text-[var(--c-accent)] hover:-translate-y-0.5',
          'active:scale-95',
        ].join(' '),
        toggleOn: [
          'text-white border-transparent breathe-accent',
          'bg-[linear-gradient(135deg,var(--c-accent)_0%,var(--c-accent-2)_100%)]',
          'hover:brightness-110 hover:-translate-y-0.5',
        ].join(' '),
        toggleDanger: [
          'text-white border-transparent breathe-danger',
          'bg-[linear-gradient(135deg,#f43f5e,#e11d48)]',
          'hover:brightness-110 hover:-translate-y-0.5',
        ].join(' '),
        toggleCyan: [
          'text-white border-transparent',
          'bg-[linear-gradient(135deg,#06b6d4,#0891b2)]',
          'shadow-[0_0_0_4px_rgba(6,182,212,0.22),0_10px_28px_-6px_rgba(6,182,212,0.5)]',
          'hover:brightness-110 hover:-translate-y-0.5',
        ].join(' '),
        toggleSuccess: [
          'text-white border-transparent',
          'bg-[linear-gradient(135deg,#10b981,#059669)]',
          'shadow-[0_0_0_4px_rgba(16,185,129,0.22),0_10px_28px_-6px_rgba(16,185,129,0.5)]',
          'hover:brightness-110 hover:-translate-y-0.5',
        ].join(' '),
      },
      shape: {
        rounded: 'rounded-xl',
        circle:  'rounded-full',
        pill:    'rounded-2xl',
      },
      size: {
        sm: 'h-8 w-8 [&_svg]:h-4 [&_svg]:w-4',
        md: 'h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]',
        lg: 'h-12 w-12 [&_svg]:h-5 [&_svg]:w-5',
        xl: 'h-14 w-14 [&_svg]:h-6 [&_svg]:w-6',
      },
    },
    defaultVariants: { variant: 'glass', size: 'md', shape: 'rounded' },
  }
)

const IconButton = forwardRef(function IconButton(
  { variant, size, shape, className, label, shortcut, tooltipSide, asMotion = true, children, ...props },
  ref
) {
  const cls = cn(variants({ variant, size, shape }), className)
  const inner = (
    <>
      {/* Sheen sweep on hover (skip for ghost/transparent variants) */}
      {variant !== 'ghost' && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -translate-x-[110%] bg-[linear-gradient(120deg,transparent_30%,rgba(255,255,255,0.28)_50%,transparent_70%)] transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/icbtn:translate-x-[110%]"
          style={{ borderRadius: 'inherit' }}
        />
      )}
      <span className="relative z-[1] inline-flex items-center justify-center transition-transform duration-200 ease-out group-hover/icbtn:scale-110 group-active/icbtn:scale-90 [&_svg]:transition-transform">
        {children}
      </span>
    </>
  )
  const node = asMotion ? (
    <motion.button
      ref={ref}
      whileTap={{ scale: 0.9 }}
      className={cls}
      aria-label={label}
      {...props}
    >
      {inner}
    </motion.button>
  ) : (
    <button ref={ref} className={cls} aria-label={label} {...props}>
      {inner}
    </button>
  )

  if (label) {
    return (
      <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
        {node}
      </Tooltip>
    )
  }
  return node
})

export default IconButton
