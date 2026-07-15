import { ArrowUp } from 'lucide-react'
import { useSemaGuide } from './store'

export default function GuideComposer() {
  const { input, setInput, sendMessage, loading, handoffState } = useSemaGuide()

  const disabled = loading || handoffState === 'human_assigned'

  const handleSubmit = () => {
    if (!input.trim() || disabled) return
    sendMessage(input)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const canSend = input.trim() && !disabled

  return (
    <div className="shrink-0 px-4 pb-3 pt-1" style={{ backgroundColor: '#FFFFFF' }}>
      {handoffState === 'human_assigned' && (
        <div className="mb-2 rounded-lg px-3 py-2 text-[11.5px]" style={{ backgroundColor: '#EEF0FF', color: '#5B5FC7' }}>
          A human specialist has joined the conversation.
        </div>
      )}
      <div
        className="flex items-end gap-2 rounded-xl border px-3.5 py-2.5 transition"
        style={{ borderColor: '#E5E8F0', backgroundColor: '#F9FAFB' }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about Zoiko Sema..."
          disabled={disabled}
          rows={1}
          className="min-h-[24px] flex-1 resize-none border-0 bg-transparent text-[13px] leading-snug outline-none"
          style={{ color: '#111827' }}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSend}
          aria-label="Send message"
          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl transition-all duration-150 active:scale-[0.97]"
          style={{
            backgroundColor: canSend ? '#5B4CE6' : '#D9DCE5',
            color: canSend ? '#FFFFFF' : '#9CA3AF',
            boxShadow: canSend ? '0 4px 12px rgba(91,76,230,0.25)' : 'none',
            cursor: canSend ? 'pointer' : 'not-allowed',
          }}
          onMouseEnter={(e) => {
            if (canSend) e.currentTarget.style.backgroundColor = '#4B3DD4'
          }}
          onMouseLeave={(e) => {
            if (canSend) e.currentTarget.style.backgroundColor = '#5B4CE6'
          }}
        >
          <ArrowUp className="h-[18px] w-[18px]" />
        </button>
      </div>

      {/* Footer disclaimer */}
      <p className="mt-2 text-center text-[10.5px] leading-tight" style={{ color: '#9CA3AF' }}>
        AI-generated guidance. Verify consequential details.
      </p>
    </div>
  )
}
