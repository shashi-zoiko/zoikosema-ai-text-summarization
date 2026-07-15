import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useSemaGuide } from '../features/sema-guide/store'
import { useAuth } from '../context/AuthContext'
import favicon from '../assets/zoikosema-icon.svg'
import '../features/sema-guide/styles.css'

const floatTransition = {
  y: { duration: 3.2, repeat: Infinity, ease: 'easeInOut' },
  boxShadow: { duration: 3.2, repeat: Infinity, ease: 'easeInOut' },
}

const glowTransition = {
  duration: 2.8,
  repeat: Infinity,
  ease: 'easeInOut',
}

export default function SemaGuideToggle() {
  const { open, isMinimized, toggle, restore } = useSemaGuide()
  const { user, loading } = useAuth()

  if (loading || !user) return null

  const isOpen = open && !isMinimized

  return (
    <>
      <motion.button
        type="button"
        onClick={isMinimized ? restore : toggle}
        aria-label="Open Sema Guide"
        className="sg-launcher fixed bottom-6 right-6 z-40"
        animate={isOpen
          ? { opacity: 0, scale: 0.92, transition: { duration: 0.24, ease: 'easeOut' } }
          : { opacity: 1, scale: 1, transition: { duration: 0.24, ease: 'easeOut', delay: 0.08 } }
        }
        initial={false}
        whileTap={!isOpen ? { scale: 0.95, transition: { duration: 0.1 } } : undefined}
        whileHover={!isOpen ? { scale: 1.06, transition: { duration: 0.18 } } : undefined}
      >
        <motion.div
          className="pointer-events-none absolute inset-0 rounded-[18px]"
          animate={!isOpen ? { opacity: [0.15, 0.35, 0.15] } : { opacity: 0 }}
          transition={glowTransition}
          style={{ boxShadow: '0 0 24px 12px rgba(91,76,230,.18)', willChange: 'opacity' }}
        />

        <motion.div
          className="sg-launcher-inner"
          animate={!isOpen
            ? {
                y: [0, -4, 0],
                boxShadow: [
                  '0 10px 24px rgba(0,0,0,.18)',
                  '0 18px 36px rgba(91,76,230,.25)',
                  '0 10px 24px rgba(0,0,0,.18)',
                ],
              }
            : {
                y: 0,
                boxShadow: '0 10px 24px rgba(0,0,0,.18)',
              }
          }
          transition={floatTransition}
          style={{ willChange: 'transform' }}
        >
          <img src={favicon} alt="" width={32} height={32} />
        </motion.div>
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.button
            key="close-btn"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            type="button"
            onClick={toggle}
            aria-label="Close Sema Guide"
            className="fixed bottom-6 z-50 grid h-10 w-10 place-items-center rounded-xl bg-[var(--c-bg-3)] text-[var(--c-fg-dim)] shadow-lg transition hover:bg-[var(--c-bg-2)] hover:text-[var(--c-fg)]"
            style={{ right: 412 }}
          >
            <X className="h-5 w-5" />
          </motion.button>
        )}
      </AnimatePresence>
    </>
  )
}
