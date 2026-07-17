import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useSemaGuide } from '../features/sema-guide/store'
import { useAuth } from '../context/AuthContext'
import favicon from '../assets/zoikosema-icon.svg'
import '../features/sema-guide/styles.css'

const yTransition = {
  y: { duration: 3.2, repeat: Infinity, ease: 'easeInOut' },
}

export default function SemaGuideToggle() {
  const { open, isMinimized, toggle, restore, unreadCount } = useSemaGuide()
  const { user, loading } = useAuth()

  if (loading || !user) return null

  const isOpen = open && !isMinimized

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      ;(isMinimized ? restore : toggle)()
    }
  }

  return (
    <>
      <motion.button
        type="button"
        onClick={isMinimized ? restore : toggle}
        onKeyDown={handleKeyDown}
        aria-label={isMinimized ? 'Restore Sema Guide' : 'Open Sema Guide'}
        className="sg-launcher fixed bottom-6 right-6 z-40"
        animate={isOpen
          ? { opacity: 0, scale: 0.92, transition: { duration: 0.24, ease: 'easeOut' } }
          : { opacity: 1, scale: 1, transition: { duration: 0.24, ease: 'easeOut', delay: 0.08 } }
        }
        initial={false}
      >
        <motion.div
          className={`sg-launcher-inner${!isOpen ? ' sg-launcher-breathe' : ''}`}
          animate={!isOpen
            ? { y: [0, -4, 0] }
            : { y: 0 }
          }
          transition={yTransition}
        >
          <img src={favicon} alt="" width={32} height={32} />
          {unreadCount > 0 && !isOpen && (
            <span className="sg-badge" aria-label={`${unreadCount} unread messages`}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
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
