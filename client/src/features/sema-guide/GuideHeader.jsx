import { MoreVertical, X } from 'lucide-react'
import { useSemaGuide } from './store'

export default function GuideHeader({ onClose }) {
  const { setOverflowOpen, overflowOpen } = useSemaGuide()

  return (
    <div
      className="sg-header flex shrink-0 items-center justify-between px-4"
      style={{ height: 60, backgroundColor: 'var(--sg-header-bg)' }}
    >
      <div className="flex items-center">
        <img src="/email-logo.png" alt="ZoikoSema" height={28} style={{ width: 'auto' }} />
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOverflowOpen(!overflowOpen)}
          aria-label="More options"
          aria-haspopup="menu"
          className="sg-header-btn"
        >
          <MoreVertical className="h-[16px] w-[16px]" />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Sema Guide"
          className="sg-header-btn"
        >
          <X className="h-[16px] w-[16px]" />
        </button>
      </div>
    </div>
  )
}
