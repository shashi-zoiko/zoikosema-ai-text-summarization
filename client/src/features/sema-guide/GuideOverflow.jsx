import { Bell, BellOff, Trash2, Shield, MessageSquare, UserCircle } from 'lucide-react'
import { motion } from 'framer-motion'
import { useSemaGuide } from './store'
import { t } from '../../lib/i18n'

export default function GuideOverflow() {
  const { clearConversation, setOverflowOpen, setSecondaryView, requestHandoff, handoffState } = useSemaGuide()

  const handleClear = () => {
    if (window.confirm(t('guide.clear.confirm'))) {
      clearConversation()
      setOverflowOpen(false)
    }
  }

  const handleHandoff = () => {
    requestHandoff()
    setOverflowOpen(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.12 }}
      className="absolute right-12 top-[68px] z-50 w-64 overflow-hidden rounded-xl border border-[var(--c-line-strong)] bg-[var(--c-surface)] p-1.5 shadow-[0_20px_56px_-16px_rgba(0,0,0,0.5)]"
      role="menu"
    >
      <MenuItem icon={<BellOff className="h-4 w-4" />} label={t('guide.overflow.mute')} />
      <MenuItem icon={<Trash2 className="h-4 w-4" />} label={t('guide.overflow.clear')} onClick={handleClear} />
      <MenuItem icon={<MessageSquare className="h-4 w-4" />} label={t('guide.overflow.handoff')} onClick={handleHandoff} disabled={handoffState === 'requesting' || handoffState === 'queued'} />
      <div className="my-1 h-px bg-[var(--c-line)]" />
      <MenuItem icon={<Shield className="h-4 w-4" />} label={t('guide.overflow.privacy')} onClick={() => setSecondaryView('privacy')} />
      <MenuItem icon={<UserCircle className="h-4 w-4" />} label={t('guide.overflow.about')} onClick={() => setSecondaryView('about')} />
    </motion.div>
  )
}

function MenuItem({ icon, label, onClick, disabled }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium text-[var(--c-fg-dim)] transition hover:bg-[var(--c-bg-3)] hover:text-[var(--c-fg)] disabled:opacity-40"
    >
      {icon}
      {label}
    </button>
  )
}
