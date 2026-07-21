import { useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSemaGuide } from './store'
import GuideHeader from './GuideHeader'
import GuideProfile from './GuideProfile'
import WelcomeState from './WelcomeState'
import GuideComposer from './GuideComposer'
import GuideOverflow from './GuideOverflow'
import PrivacyData from './PrivacyData'
import AboutGuide from './AboutGuide'
import AiMessage from './AiMessage'
import UserMessage from './UserMessage'
import ProcessingState from './ProcessingState'
import ConfidentialModeBanner from './ConfidentialModeBanner'
import './styles.css'

export default function SemaGuidePanel() {
  const {
    open, isMinimized, secondaryView, messages, loading, processing, error,
    closePanel, overflowOpen, confidential,
    supportState, fetchHandoffState,
  } = useSemaGuide()
  const endRef = useRef(null)
  const pollRef = useRef(null)
  const panelRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, processing])

  useEffect(() => {
    if (!open) return

    const handleClickOutside = (e) => {
      if (panelRef.current && panelRef.current.contains(e.target)) return
      if (e.target.closest?.('[data-sema-guide-toggle]')) return
      closePanel()
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open, closePanel])

  useEffect(() => {
    const { status, ticketId } = supportState
    const activeStatuses = ['email_sending', 'email_sent', 'waiting_for_specialist']
    const shouldPoll = !!ticketId && activeStatuses.includes(status)
    if (shouldPoll && !pollRef.current) {
      pollRef.current = setInterval(fetchHandoffState, 10000)
    }
    if (!shouldPoll && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [supportState, fetchHandoffState])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.aside
            ref={panelRef}
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={isMinimized
              ? { opacity: 0, scale: 0.92, y: 12, transition: { duration: 0.24, ease: 'easeOut' } }
              : { opacity: 1, scale: 1, y: 0 }
            }
            exit={{ opacity: 0, scale: 0.92, y: 12 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
            className="sg-panel fixed bottom-6 right-6 z-50 flex flex-col overflow-hidden rounded-[22px] border shadow-[0_10px_40px_rgba(0,0,0,0.12)]"
            style={{ width: 380, height: 510, borderColor: '#E5E8F0', backgroundColor: '#FFFFFF', transformOrigin: 'bottom right' }}
            role="dialog"
            aria-label="Sema Guide — AI support agent"
            aria-modal="true"
          >
            {secondaryView === 'privacy' ? (
              <PrivacyData />
            ) : secondaryView === 'about' ? (
              <AboutGuide />
            ) : (
              <>
                <GuideHeader onClose={closePanel} />

                {overflowOpen && <GuideOverflow />}

                <GuideProfile />

                <ConfidentialModeBanner active={confidential} />

                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4" style={{ gap: 12 }}>
                  {messages.length === 0 && !loading && !processing ? (
                    <WelcomeState />
                  ) : (
                    messages.map((msg, i) =>
                      msg.role === 'user' ? (
                        <UserMessage key={i} content={msg.content} timestamp={msg.timestamp} />
                      ) : (
                        <AiMessage
                          key={i}
                          content={msg.content}
                          verified={msg.verified}
                          actionPreview={msg.action_preview}
                        />
                      )
                    )
                  )}

                  {processing && <ProcessingState task={processing} />}
                  {loading && !processing && (
                    <div className="flex items-center gap-2 px-1 py-2">
                      <span className="flex gap-1">
                        <span className="block h-2 w-2 animate-bounce rounded-full" style={{ backgroundColor: '#9CA3AF', animationDelay: '0s' }} />
                        <span className="block h-2 w-2 animate-bounce rounded-full" style={{ backgroundColor: '#9CA3AF', animationDelay: '0.15s' }} />
                        <span className="block h-2 w-2 animate-bounce rounded-full" style={{ backgroundColor: '#9CA3AF', animationDelay: '0.3s' }} />
                      </span>
                    </div>
                  )}

                  {error && (
                    <div className="rounded-xl border px-3 py-2 text-[12.5px]" style={{ borderColor: '#FECACA', backgroundColor: '#FEF2F2', color: '#DC2626' }}>
                      {error}
                    </div>
                  )}

                  <div ref={endRef} />
                </div>

                <GuideComposer />
              </>
            )}
          </motion.aside>

          <div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm sm:hidden"
            onClick={closePanel}
            aria-hidden
          />
        </>
      )}
    </AnimatePresence>
  )
}
