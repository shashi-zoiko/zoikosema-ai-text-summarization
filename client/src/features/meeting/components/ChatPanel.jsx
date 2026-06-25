import { useEffect, useRef, useState } from 'react'
import { MessagesSquare, Send } from 'lucide-react'
import DrawerShell from './DrawerShell.jsx'

/**
 * In-call chat — dark enterprise drawer with a modern messaging layout:
 *   • own messages right-aligned in an accent gradient bubble
 *   • others left-aligned with a coloured profile avatar + name/time header
 *   • consecutive messages from one sender are grouped (avatar shown once)
 * The composer is a pill input docked to the bottom (sticky DrawerShell footer).
 */
export default function ChatPanel({ messages, onSend, onClose, disabled, selfUserId }) {
  const [draft, setDraft] = useState('')
  const endRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length])

  // Focus the composer when the panel opens.
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

  const footer = (
    <form onSubmit={submit} className="shrink-0 border-t border-[#263244] bg-[#111827] px-3 py-3">
      <div className="flex items-center gap-2 rounded-full border border-[#263244] bg-[#0B1220] py-1.5 pl-4 pr-1.5 transition focus-within:border-[#10B981] focus-within:shadow-[0_0_0_3px_rgba(16,185,129,0.15)]">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={disabled ? 'Chat is disabled by the host' : 'Send a message to everyone'}
          disabled={disabled}
          maxLength={2000}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] leading-8 text-white outline-none placeholder:text-[#64748B] focus:ring-0 disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={disabled || !draft.trim()}
          aria-label="Send message"
          className={
            'grid h-8 w-8 shrink-0 place-items-center rounded-full text-white transition-all duration-200 ' +
            'enabled:bg-gradient-to-br enabled:from-[#34D399] enabled:to-[#059669] ' +
            'enabled:shadow-[0_4px_14px_-4px_rgba(16,185,129,0.7),inset_0_1px_0_rgba(255,255,255,0.3)] ' +
            'enabled:hover:from-[#10B981] enabled:hover:to-[#047857] enabled:active:scale-95 ' +
            'disabled:bg-[#1E293B] disabled:text-[#475569]'
          }
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </form>
  )

  return (
    <DrawerShell title="In-call chat" onClose={onClose} footer={footer} bodyClassName="flex flex-col px-3 py-4">
      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-[#10B981]/12 text-[#34D399] ring-1 ring-[#10B981]/25">
            <MessagesSquare className="h-6 w-6" />
          </div>
          <p className="text-[13px] font-medium text-white/90">No messages yet</p>
          <p className="max-w-[240px] text-[12px] leading-relaxed text-[#94A3B8]">
            Messages are visible to everyone in the call and are deleted when the
            call ends.
          </p>
        </div>
      ) : (
        messages.map((m, i) => {
          const prev = i > 0 ? messages[i - 1] : null
          return (
            <ChatMessage
              key={m._key ?? i}
              m={m}
              prev={prev}
              first={i === 0}
              isSelf={selfUserId != null && m.user_id === selfUserId}
            />
          )
        })
      )}
      <div ref={endRef} />
    </DrawerShell>
  )
}

function ChatMessage({ m, prev, first, isSelf }) {
  const time = m.created_at
    ? new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : ''
  // Group consecutive messages from the same sender within 2 minutes — prefer a
  // stable user_id, fall back to display name for guests without one.
  const sameId =
    prev &&
    (prev.user_id != null && m.user_id != null
      ? prev.user_id === m.user_id
      : prev.name === m.name)
  const sameAsPrev =
    sameId &&
    prev.created_at &&
    m.created_at &&
    new Date(m.created_at) - new Date(prev.created_at) < 2 * 60 * 1000

  const color = m.color || '#34D399'
  const name = m.name || 'Guest'
  const gap = first ? '' : sameAsPrev ? 'mt-1' : 'mt-4'

  // ── Own messages: right-aligned accent gradient bubble, no avatar ──────────
  if (isSelf) {
    return (
      <div className={`flex flex-col items-end ${gap}`}>
        {!sameAsPrev && (
          <div className="mb-1 flex items-baseline gap-2 pr-1">
            <span className="text-[12px] font-semibold text-[#34D399]">You</span>
            {time && <span className="text-[11px] text-[#64748B]">{time}</span>}
          </div>
        )}
        <div className="max-w-[82%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-gradient-to-br from-[#10B981] to-[#059669] px-3.5 py-2 text-[13px] leading-snug text-white shadow-[0_4px_14px_-6px_rgba(16,185,129,0.65)]">
          {m.body}
        </div>
      </div>
    )
  }

  // ── Others: left-aligned with profile avatar (shown once per group) ────────
  return (
    <div className={`flex items-start gap-2.5 ${gap}`}>
      <div className="w-8 shrink-0 pt-0.5">
        {!sameAsPrev && (
          <div
            className="grid h-8 w-8 place-items-center rounded-full text-[12px] font-semibold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_2px_8px_-2px_rgba(0,0,0,0.5)]"
            style={{ background: `linear-gradient(145deg, ${color}, ${color}cc)` }}
            title={name}
          >
            {name.slice(0, 1)}
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {!sameAsPrev && (
          <div className="mb-1 flex items-baseline gap-2">
            <span className="truncate text-[12px] font-semibold" style={{ color }}>
              {name}
            </span>
            {time && <span className="shrink-0 text-[11px] text-[#64748B]">{time}</span>}
          </div>
        )}
        <div className="w-fit max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-tl-md border border-[#263244] bg-[#1B2536] px-3.5 py-2 text-[13px] leading-snug text-white/90">
          {m.body}
        </div>
      </div>
    </div>
  )
}
