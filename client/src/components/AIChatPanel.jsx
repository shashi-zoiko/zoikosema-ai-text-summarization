import { useState, useRef, useEffect } from 'react'
import { api } from '../api/client'
import Icon from './Icon'
import { cn } from '../lib/cn'

/* ─────────────────────────────────────────────────────────────────────────
 * AIChatPanel — embedded chat with the Zoiko AI assistant.
 * Companion AIChatPanel.css gone. Typing dots reuse Tailwind's
 * animate-bounce with cascaded delays — same effect as the old aiBounce
 * keyframe, no custom CSS.
 * ──────────────────────────────────────────────────────────────────────── */

const QUICK_ACTIONS = [
  { label: 'Summarize chat', prompt: 'Please summarize the meeting chat so far.' },
  { label: 'Generate notes', prompt: 'Generate meeting notes with action items from the discussion.' },
  { label: 'Meeting tips', prompt: 'Give me some tips for running an effective meeting.' },
  { label: 'Help', prompt: 'What can you help me with?' },
]

export default function AIChatPanel({ meetingContext, onClose, embedded = false }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async (text) => {
    const userMsg = text || input.trim()
    if (!userMsg) return
    setInput('')

    const newMessages = [...messages, { role: 'user', content: userMsg }]
    setMessages(newMessages)
    setLoading(true)

    try {
      const body = {
        messages: newMessages.map(m => ({ role: m.role, content: m.content })),
      }
      if (meetingContext) body.meeting_context = meetingContext
      const res = await api('/api/ai/chat', { method: 'POST', body })
      setMessages(prev => [...prev, { role: 'assistant', content: res.response }])
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}` }])
    } finally {
      setLoading(false)
    }
  }

  const summarize = async () => {
    if (!meetingContext?.chat_log) {
      sendMessage('Please summarize the meeting chat so far.')
      return
    }
    setLoading(true)
    setMessages(prev => [...prev, { role: 'user', content: 'Summarize the meeting chat.' }])
    try {
      const res = await api('/api/ai/summarize', {
        method: 'POST',
        body: {
          chat_log: meetingContext.chat_log,
          meeting_title: meetingContext.title || 'Meeting',
        },
      })
      setMessages(prev => [...prev, { role: 'assistant', content: res.summary }])
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}` }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className={cn(
        'flex h-full flex-col overflow-hidden',
        embedded
          ? 'border-0 bg-transparent'
          : 'rounded-lg border border-line bg-bg-2'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <div
            className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-md text-white"
            style={{ background: 'var(--accent-gradient)' }}
          >
            <Icon name="robot" size={18} />
          </div>
          <div>
            <div className="text-[14px] font-semibold">Zoiko AI</div>
            <div className="text-[11px] text-fg-muted">Your meeting assistant</div>
          </div>
        </div>
        {onClose && (
          <button className="ghost" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="px-2 py-6 text-center">
            <div
              className="mx-auto mb-3.5 grid h-14 w-14 place-items-center rounded-full text-white"
              style={{ background: 'var(--accent-gradient)' }}
            >
              <Icon name="robot" size={32} />
            </div>
            <h3 className="m-0 mb-1.5 text-[17px] font-semibold">Hi! I'm Zoiko AI</h3>
            <p className="m-0 mb-[18px] text-[13px] text-fg-muted">
              I can help you with meeting summaries, notes, tips, and more.
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {QUICK_ACTIONS.map((a, i) => (
                <button
                  key={i}
                  onClick={() => a.label === 'Summarize chat' ? summarize() : sendMessage(a.prompt)}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] text-accent transition"
                  style={{
                    background: 'rgba(124,140,255,0.08)',
                    borderColor: 'rgba(124,140,255,0.2)',
                  }}
                  onMouseEnter={(ev) => {
                    ev.currentTarget.style.background = 'rgba(124,140,255,0.15)'
                    ev.currentTarget.style.borderColor = 'rgba(124,140,255,0.35)'
                  }}
                  onMouseLeave={(ev) => {
                    ev.currentTarget.style.background = 'rgba(124,140,255,0.08)'
                    ev.currentTarget.style.borderColor = 'rgba(124,140,255,0.2)'
                  }}
                >
                  <Icon name="zap" size={12} />
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <Message key={i} role={m.role} content={m.content} />
        ))}

        {loading && <Message role="assistant" typing />}

        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="flex gap-2 border-t border-line px-4 py-3">
        <input
          placeholder="Ask Zoiko AI anything..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
          disabled={loading}
          className="!flex-1 !rounded-sm !border-line !bg-bg px-3 !py-2.5 !text-[13px] !text-fg focus:!border-accent focus:!outline-none"
        />
        <button
          className="primary"
          onClick={() => sendMessage()}
          disabled={!input.trim() || loading}
          style={{ width: 38, height: 38, padding: 0, flexShrink: 0 }}
        >
          <Icon name="send" size={16} />
        </button>
      </div>
    </div>
  )
}

/* ────────────────────── pieces ────────────────────── */

function Message({ role, content, typing }) {
  const isUser = role === 'user'
  return (
    <div
      className={cn(
        'flex max-w-[90%] gap-2',
        isUser ? 'flex-row-reverse self-end' : 'self-start'
      )}
    >
      {!isUser && (
        <div
          className="mt-0.5 grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full text-white"
          style={{ background: 'var(--accent-gradient)' }}
        >
          <Icon name="robot" size={14} />
        </div>
      )}
      <div
        className={cn(
          'rounded-[14px] px-3.5 py-2.5 text-[13px] leading-[1.55]',
          isUser
            ? 'rounded-br-[4px] bg-accent text-white'
            : 'rounded-bl-[4px] border border-line bg-bg-1 text-fg shadow-xs'
        )}
      >
        {typing ? <TypingDots /> : (
          <div className="whitespace-pre-wrap break-words">{content}</div>
        )}
      </div>
    </div>
  )
}

function TypingDots() {
  return (
    <div className="flex gap-1 py-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="block h-1.5 w-1.5 animate-bounce rounded-full bg-fg-muted"
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </div>
  )
}
