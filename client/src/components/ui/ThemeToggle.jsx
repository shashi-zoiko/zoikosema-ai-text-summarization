import { AnimatePresence, motion } from 'framer-motion'
import { Moon, Sun } from 'lucide-react'
import { useTheme, THEMES } from '../../theme/ThemeProvider'
import { cn } from '../../lib/cn'

const ICONS = {
  midnight: Moon,
  light: Sun,
}

/**
 * Compact theme toggle — cycles through registered themes inline so it works
 * inside the meeting room top bar (no flyout menu). Animated icon swap.
 */
export default function ThemeToggle({ className }) {
  const { theme, setTheme } = useTheme()
  const current = THEMES.find((t) => t.id === theme) || THEMES[0]
  const Icon = ICONS[current.id] || Moon

  const cycle = () => {
    const idx = THEMES.findIndex((t) => t.id === theme)
    const next = THEMES[(idx + 1) % THEMES.length]
    setTheme(next.id)
  }

  return (
    <motion.button
      onClick={cycle}
      whileTap={{ scale: 0.92 }}
      whileHover={{ y: -1 }}
      aria-label={`Theme: ${current.label}. Click to switch.`}
      title={`Theme: ${current.label}`}
      className={cn(
        'group relative inline-flex h-9 items-center gap-2 overflow-hidden rounded-full px-3',
        'border border-white/10 bg-[color-mix(in_srgb,var(--c-surface)_60%,transparent)]',
        'text-[12px] font-medium text-[var(--c-fg-dim)]',
        'backdrop-blur-md transition-colors hover:text-[var(--c-fg)] hover:border-white/20',
        className
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            'radial-gradient(closest-side, color-mix(in srgb, var(--c-accent) 22%, transparent), transparent 70%)',
        }}
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={current.id}
          initial={{ rotate: -90, opacity: 0, scale: 0.7 }}
          animate={{ rotate: 0, opacity: 1, scale: 1 }}
          exit={{ rotate: 90, opacity: 0, scale: 0.7 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="relative flex h-5 w-5 items-center justify-center text-[var(--c-accent)]"
        >
          <Icon className="h-4 w-4" />
        </motion.span>
      </AnimatePresence>
      <span className="relative hidden sm:inline">{current.label.split(' ')[0]}</span>
    </motion.button>
  )
}
