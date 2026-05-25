import { useEffect, useRef, useState } from 'react'
import { Send, X } from 'lucide-react'

export default function ChatPanel({ messages, onSend, onClose, disabled }) {
  const [draft, setDraft] = useState('')
  const endRef = useRef(null)

  // Auto-scroll to the latest message when the list grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length])

  const submit = (e) => {
    e?.preventDefault()
    const body = draft.trim()
    if (!body || disabled) return
    onSend(body)
    setDraft('')
  }

  return (
    <aside className="w-80 max-w-[85vw] flex flex-col bg-zinc-900 border-l border-zinc-800 text-zinc-100">
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <h2 className="text-sm font-semibold">In-call messages</h2>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100"
          title="Close"
        >
          <X size={18} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 ? (
          <div className="text-xs text-zinc-500 text-center mt-6">
            Messages can be seen by everyone in the call.
          </div>
        ) : (
          messages.map((m, i) => <ChatMessage key={m._key ?? i} m={m} />)
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="p-3 border-t border-zinc-800 flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={disabled ? 'Chat disabled by host' : 'Send a message…'}
          disabled={disabled}
          maxLength={2000}
          className="flex-1 bg-zinc-800 text-sm px-3 py-2 rounded outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || !draft.trim()}
          className="p-2 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Send"
        >
          <Send size={16} />
        </button>
      </form>
    </aside>
  )
}

function ChatMessage({ m }) {
  const time = m.created_at
    ? new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : ''
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-0.5">
        <span
          className="text-xs font-semibold"
          style={{ color: m.color || '#a3a3a3' }}
        >
          {m.name || 'Guest'}
        </span>
        <span className="text-[10px] text-zinc-500">{time}</span>
      </div>
      <div className="text-sm text-zinc-200 whitespace-pre-wrap break-words">
        {m.body}
      </div>
    </div>
  )
}
