import { useEffect, useRef } from 'react'
import { Trash2, Shield, MessageSquare, UserCircle, Loader2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { useSemaGuide } from './store'
import { useToast } from '../../components/ui/Toast'
import { t } from '../../lib/i18n'

function supportStatusLabel(status) {
  const labels = {
    email_sending: 'Sending confirmation...',
    email_sent: 'Awaiting specialist',
    waiting_for_specialist: 'Waiting for specialist',
    specialist_assigned: 'Specialist assigned',
    active_chat: 'Active chat',
    closed: 'Closed',
    failed: 'Failed',
  }
  return labels[status] || status
}

export default function GuideOverflow() {
  const { toast } = useToast()
  const { clearConversation, setOverflowOpen, setSecondaryView, requestHandoff, supportState } = useSemaGuide()
  const { ticketId, status, requesting } = supportState
  const hasActiveTicket = !!ticketId && status !== 'closed' && status !== 'failed'
  const menuRef = useRef(null)

  // Dismiss on click outside the menu or on Escape. The header's toggle button
  // is excluded so a click on it runs its own toggle instead of this closing it
  // and the button immediately reopening it.
  useEffect(() => {
    const handlePointerDown = (e) => {
      if (menuRef.current?.contains(e.target)) return
      if (e.target.closest?.('[data-guide-overflow-toggle]')) return
      setOverflowOpen(false)
    }
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setOverflowOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [setOverflowOpen])

  const handleClear = () => {
    if (window.confirm(t('guide.clear.confirm'))) {
      clearConversation()
      setOverflowOpen(false)
    }
  }

  const handleHandoff = () => {
    if (hasActiveTicket) {
      toast({ variant: 'info', title: 'Support request already submitted', description: `Ticket ${ticketId} — ${supportStatusLabel(status)}.` })
      setOverflowOpen(false)
      return
    }
    requestHandoff()
    toast({ variant: 'success', title: 'Support request submitted', description: 'Confirmation email sent.' })
    setOverflowOpen(false)
  }

  return (
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.12 }}
      className="absolute right-12 top-[68px] z-50 w-72 overflow-hidden rounded-xl border border-[var(--c-line-strong)] bg-[var(--c-surface)] p-1.5 shadow-[0_20px_56px_-16px_rgba(0,0,0,0.5)]"
      role="menu"
    >
      <MenuItem icon={<Trash2 className="h-4 w-4" />} label={t('guide.overflow.clear')} onClick={handleClear} />

      {/* Contact support — always shows action label, status/ticket below */}
      <div className="group" role="menuitem">
        <button
          type="button"
          onClick={handleHandoff}
          disabled={requesting}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium text-[var(--c-fg-dim)] transition hover:bg-[var(--c-bg-3)] hover:text-[var(--c-fg)] disabled:opacity-40"
        >
          {requesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
          <span className="flex-1">Contact support</span>
        </button>
        {hasActiveTicket && (
          <div className="px-9 pb-2 pt-0.5">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-medium" style={{ color: 'var(--c-fg-muted)' }}>Status:</span>
                <span className="text-[10px]" style={{ color: 'var(--c-fg-dim)' }}>{supportStatusLabel(status)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-medium" style={{ color: 'var(--c-fg-muted)' }}>Ticket:</span>
                <span className="text-[10px] font-mono font-semibold" style={{ color: '#4B3DD4' }}>{ticketId}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="my-1 h-px bg-[var(--c-line)]" />
      <MenuItem icon={<Shield className="h-4 w-4" />} label={t('guide.overflow.privacy')} onClick={() => setSecondaryView('privacy')} />
      <MenuItem icon={<UserCircle className="h-4 w-4" />} label={t('guide.overflow.about')} onClick={() => setSecondaryView('about')} />
    </motion.div>
  )
}

function MenuItem({ icon, label, onClick, disabled, suffix }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium text-[var(--c-fg-dim)] transition hover:bg-[var(--c-bg-3)] hover:text-[var(--c-fg)] disabled:opacity-40"
    >
      {icon}
      <span className="flex-1">{label}</span>
      {suffix}
    </button>
  )
}
