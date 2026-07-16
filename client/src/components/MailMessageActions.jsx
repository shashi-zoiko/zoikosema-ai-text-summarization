import { useState } from 'react'
import { CalendarPlus, ListChecks, Send, Sparkles } from 'lucide-react'
import { api } from '../api/client'
import Button from './ui/Button'
import Modal from './ui/Modal'
import { Field, Input } from './ui/Input'
import Badge from './ui/Badge'
import Spinner from './ui/Spinner'
import { useToast } from './ui/Toast'

/* Phase 3 slice 8 (AI thread summaries + reply drafts, L1-L2) and slice 10
 * (email-to-meeting/task governed conversions) — the action bar under a
 * read message in the Inbox reading pane. Read-only rendering itself is
 * MailBodyView's job (slice 4); everything here calls a real, governed
 * backend endpoint — summarize is a pure read, drafting/sending/converting
 * all go through the same autonomy/DLP/Work-Graph wiring the backend
 * enforces regardless of what this UI does. */

function DlpBadge({ verdict }) {
  if (!verdict) return null
  const tone = verdict === 'fail' ? 'danger' : verdict === 'warn' ? 'warn' : 'success'
  return <Badge tone={tone} size="sm">DLP: {verdict}</Badge>
}

function SummaryPanel({ message }) {
  const [state, setState] = useState({ loading: false, data: null, error: null })

  const run = async () => {
    setState({ loading: true, data: null, error: null })
    try {
      const data = await api(`/api/connect/mail/threads/${encodeURIComponent(message.thread_id)}/summary`)
      setState({ loading: false, data, error: null })
    } catch (err) {
      setState({ loading: false, data: null, error: err.message })
    }
  }

  return (
    <div>
      <Button variant="outline" size="sm" disabled={state.loading} leftIcon={state.loading ? <Spinner size="sm" /> : <Sparkles className="h-3.5 w-3.5" />} onClick={run}>
        {state.loading ? 'Summarizing…' : 'Summarize thread'}
      </Button>
      {state.error && <p className="mt-2 text-[12.5px] text-[var(--c-danger)]">{state.error}</p>}
      {state.data && (
        <div className="mt-3 rounded-[10px] border border-[var(--c-line)] bg-[var(--c-bg-2)] p-3.5">
          <p className="text-[13px] text-[var(--c-fg)]">{state.data.summary}</p>
          {state.data.key_points?.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[12.5px] text-[var(--c-fg-muted)]">
              {state.data.key_points.map((k, i) => <li key={i}>{k}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function DraftReplyModal({ message, open, onClose }) {
  const { toast } = useToast()
  const [instruction, setInstruction] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [draft, setDraft] = useState(null) // { subject, body_text, dlp_verdict, staged, review_item }
  const [error, setError] = useState(null)
  const [toEmails, setToEmails] = useState(message.from_email)
  const [sending, setSending] = useState(false)

  const generate = async () => {
    if (!instruction.trim()) return
    setDrafting(true)
    setError(null)
    setDraft(null)
    try {
      const result = await api(`/api/connect/mail/threads/${encodeURIComponent(message.thread_id)}/draft-reply`, {
        method: 'POST', body: { instruction },
      })
      setDraft(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setDrafting(false)
    }
  }

  const send = async () => {
    setSending(true)
    setError(null)
    try {
      const result = await api('/api/connect/mail/sends', {
        method: 'POST',
        body: {
          provider: message.provider, to_emails: toEmails.split(',').map((e) => e.trim()).filter(Boolean),
          subject: draft.subject, body_text: draft.body_text, thread_id: message.thread_id,
        },
      })
      toast(`Reply buffered — sends at ${new Date(result.scheduled_release_at).toLocaleTimeString()} unless cancelled`)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Draft a reply" size="lg">
      <div className="space-y-4">
        <Field label="Instruction" hint="e.g. &quot;Decline politely and suggest next week instead&quot;">
          <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="How should Sema reply?" />
        </Field>
        <Button variant="outline" size="sm" disabled={drafting || !instruction.trim()} leftIcon={drafting ? <Spinner size="sm" /> : <Sparkles className="h-3.5 w-3.5" />} onClick={generate}>
          {drafting ? 'Drafting…' : draft ? 'Regenerate' : 'Generate draft'}
        </Button>

        {error && <p className="text-[12.5px] text-[var(--c-danger)]">{error}</p>}

        {draft && !draft.staged && (
          <div className="space-y-3 rounded-[10px] border border-[var(--c-line)] bg-[var(--c-bg-2)] p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-[var(--c-fg)]">{draft.subject}</span>
              <DlpBadge verdict={draft.dlp_verdict} />
            </div>
            <p className="whitespace-pre-wrap text-[13px] text-[var(--c-fg-dim)]">{draft.body_text}</p>
            <Field label="Send to">
              <Input value={toEmails} onChange={(e) => setToEmails(e.target.value)} placeholder="comma-separated emails" />
            </Field>
            <Button variant="primary" size="sm" disabled={sending} leftIcon={sending ? <Spinner size="sm" /> : <Send className="h-3.5 w-3.5" />} onClick={send}>
              {sending ? 'Buffering send…' : 'Send (cancellable window)'}
            </Button>
          </div>
        )}

        {draft?.staged && (
          <div className="rounded-[10px] border border-[var(--c-line)] bg-[var(--c-bg-2)] p-3.5 text-[13px] text-[var(--c-fg-muted)]">
            This draft was staged in the Review Queue for approval (your workspace's mail policy requires review before a draft can be sent).
          </div>
        )}
      </div>
    </Modal>
  )
}

function ConvertToTaskModal({ message, open, onClose }) {
  const { toast } = useToast()
  const [title, setTitle] = useState(message.subject || '')
  const [priority, setPriority] = useState('med')
  const [assignee, setAssignee] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async () => {
    if (!title.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api(`/api/connect/mail/messages/${encodeURIComponent(message.id)}/convert-to-task`, {
        method: 'POST', body: { title, priority, assignee_email: assignee.trim() || undefined },
      })
      toast('Task created from this email')
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Convert to task">
      <div className="space-y-4">
        <Field label="Title" required><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Priority">
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="h-11 w-full rounded-xl border border-[var(--c-line-strong)] bg-[var(--c-bg-1)] px-3.5 text-[14px] text-[var(--c-fg)] outline-none focus:border-[var(--c-accent)]"
          >
            <option value="low">Low</option>
            <option value="med">Medium</option>
            <option value="high">High</option>
          </select>
        </Field>
        <Field label="Assignee email" hint={`Defaults to ${message.from_email} if left blank`}>
          <Input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder={message.from_email} />
        </Field>
        {error && <p className="text-[12.5px] text-[var(--c-danger)]">{error}</p>}
        <Button variant="primary" size="sm" disabled={busy || !title.trim()} leftIcon={busy ? <Spinner size="sm" /> : <ListChecks className="h-3.5 w-3.5" />} onClick={submit}>
          {busy ? 'Creating…' : 'Create task'}
        </Button>
      </div>
    </Modal>
  )
}

function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function ConvertToMeetingModal({ message, open, onClose }) {
  const { toast } = useToast()
  const now = new Date()
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000)
  const inNinetyMin = new Date(now.getTime() + 90 * 60 * 1000)
  const [title, setTitle] = useState(message.subject || '')
  const [startAt, setStartAt] = useState(toLocalInputValue(inOneHour))
  const [endAt, setEndAt] = useState(toLocalInputValue(inNinetyMin))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async () => {
    if (!title.trim() || !startAt || !endAt) return
    setBusy(true)
    setError(null)
    try {
      const result = await api(`/api/connect/mail/messages/${encodeURIComponent(message.id)}/convert-to-meeting`, {
        method: 'POST',
        body: {
          title, start_at: new Date(startAt).toISOString(), end_at: new Date(endAt).toISOString(),
          timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone,
          attendees: [{ email: message.from_email }],
        },
      })
      toast(result.staged ? 'Meeting staged for review' : 'Meeting created from this email')
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Convert to meeting">
      <div className="space-y-4">
        <Field label="Title" required><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts" required><Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} /></Field>
          <Field label="Ends" required><Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} /></Field>
        </div>
        <p className="text-[12px] text-[var(--c-fg-muted)]">{message.from_email} will be added as an attendee.</p>
        {error && <p className="text-[12.5px] text-[var(--c-danger)]">{error}</p>}
        <Button variant="primary" size="sm" disabled={busy || !title.trim()} leftIcon={busy ? <Spinner size="sm" /> : <CalendarPlus className="h-3.5 w-3.5" />} onClick={submit}>
          {busy ? 'Creating…' : 'Create meeting'}
        </Button>
      </div>
    </Modal>
  )
}

export default function MailMessageActions({ message }) {
  const [openModal, setOpenModal] = useState(null) // 'reply' | 'task' | 'meeting' | null

  return (
    <div className="mt-4 border-t border-[var(--c-line)] pt-3">
      <div className="mb-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" leftIcon={<Send className="h-3.5 w-3.5" />} onClick={() => setOpenModal('reply')}>Draft reply</Button>
        <Button variant="outline" size="sm" leftIcon={<ListChecks className="h-3.5 w-3.5" />} onClick={() => setOpenModal('task')}>Convert to task</Button>
        <Button variant="outline" size="sm" leftIcon={<CalendarPlus className="h-3.5 w-3.5" />} onClick={() => setOpenModal('meeting')}>Convert to meeting</Button>
      </div>

      <SummaryPanel message={message} />

      {openModal === 'reply' && <DraftReplyModal message={message} open onClose={() => setOpenModal(null)} />}
      {openModal === 'task' && <ConvertToTaskModal message={message} open onClose={() => setOpenModal(null)} />}
      {openModal === 'meeting' && <ConvertToMeetingModal message={message} open onClose={() => setOpenModal(null)} />}
    </div>
  )
}
