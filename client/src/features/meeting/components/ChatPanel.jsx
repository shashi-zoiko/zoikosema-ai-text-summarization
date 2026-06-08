import { useEffect, useRef, useState } from 'react'
import { Send, X } from 'lucide-react'

/**
 * Google-Meet-style in-call chat panel.
 *
 * Lives inside the floating sidebar shell (rounded, ring, shadow) that
 * MeetRoomLivekit drops in. Messages are grouped visually by sender with
 * a bubble per body; consecutive messages from the same person share a
 * header. The composer is a pill input with the send button inline on
 * the right — Meet uses the same affordance.
 */
export default function ChatPanel({ messages, onSend, onClose, disabled }) {
  const [draft, setDraft] = useState('')
  const endRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length])

  // Focus the composer when the panel opens so the user can type
  // immediately without an extra click.
  useEffect(() => {
    if (!disabled) inputRef.current?.focus()
  }, [disabled])

  const submit = (e) => {
    e?.preventDefault()
    const body = draft.trim()
    if (!body || disabled) return
    onSend(body)
    setDraft('')
  }

  return (
    <aside className="m-2 flex h-[calc(100%-1rem)] w-[340px] shrink-0 flex-col overflow-hidden rounded-2xl bg-white text-[#202124] shadow-[0_12px_40px_-16px_rgba(0,0,0,0.25)] ring-1 ring-black/[0.06]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-black/[0.06] px-4">
        <h2 className="text-[15px] font-medium">In-call messages</h2>
        <button
          onClick={onClose}
          aria-label="Close chat"
          className="grid h-8 w-8 place-items-center rounded-full text-[#5f6368] transition hover:bg-black/[0.06] hover:text-[#202124]"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <p className="px-3 py-8 text-center text-[13px] leading-relaxed text-[#5f6368]">
            Messages can be seen only by people in the call and are deleted
            when the call ends.
          </p>
        ) : (
          messages.map((m, i) => (
            <ChatMessage
              key={m._key ?? i}
              m={m}
              prev={i > 0 ? messages[i - 1] : null}
            />
          ))
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={submit}
        className="shrink-0 border-t border-black/[0.06] p-3"
      >
        <div className="flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-[#f1f3f4] px-3 py-1.5 transition focus-within:border-[#1a73e8]">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={disabled ? 'Chat is disabled by the host' : 'Send a message'}
            disabled={disabled}
            maxLength={2000}
            className="min-w-0 flex-1 bg-transparent text-sm text-[#202124] outline-none placeholder:text-[#9aa0a6] disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={disabled || !draft.trim()}
            aria-label="Send"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#1a73e8] transition enabled:hover:bg-[#1a73e8]/10 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </aside>
  )
}

function ChatMessage({ m, prev }) {
  const time = m.created_at
    ? new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : ''
  // Group consecutive messages from the same user within 2 minutes — same
  // sender + same minute window means we drop the name/time header to read
  // as a single conversation block (Meet does this too).
  const sameAsPrev =
    prev &&
    prev.name === m.name &&
    prev.created_at &&
    m.created_at &&
    new Date(m.created_at) - new Date(prev.created_at) < 2 * 60 * 1000

  return (
    <div className="text-[13px]">
      {!sameAsPrev && (
        <div className="mb-1 flex items-baseline gap-2 px-1">
          <span className="font-semibold" style={{ color: m.color || '#a3a3a3' }}>
            {m.name || 'Guest'}
          </span>
          <span className="text-[11px] text-[#5f6368]">{time}</span>
        </div>
      )}
      <div className="rounded-2xl rounded-tl-md bg-[#f1f3f4] px-3 py-2 leading-snug text-[#202124] break-words whitespace-pre-wrap">
        {m.body}
      </div>
    </div>
  )
}
