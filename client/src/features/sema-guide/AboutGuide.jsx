import { useEffect, useCallback } from 'react'
import { ArrowLeft, X, Sparkles, Shield, Users, ExternalLink, CheckCircle, AlertTriangle, Info, RefreshCw, AlertCircle, CheckCircle2, Clock, Mail } from 'lucide-react'
import { useSemaGuide } from './store'
import { useToast } from '../../components/ui/Toast'
import favicon from '../../assets/zoikosema-icon.svg'

function LoadingSkeleton() {
  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--c-bg)' }}>
      <div className="flex shrink-0 items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--c-line)', backgroundColor: 'var(--c-surface)' }}>
        <div className="h-8 w-8 rounded-lg bg-[var(--c-bg-3)] animate-pulse" />
        <div className="flex-1 space-y-1">
          <div className="h-4 w-28 rounded bg-[var(--c-bg-3)] animate-pulse" />
          <div className="h-3 w-16 rounded bg-[var(--c-bg-3)] animate-pulse" style={{ opacity: 0.6 }} />
        </div>
        <div className="h-8 w-8 rounded-lg bg-[var(--c-bg-3)] animate-pulse" />
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <div className="rounded-xl border px-4 py-4" style={{ borderColor: 'var(--c-line)', backgroundColor: 'var(--c-surface)' }}>
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded bg-[var(--c-bg-3)] animate-pulse" />
            <div className="space-y-1.5 flex-1">
              <div className="h-4 w-24 rounded bg-[var(--c-bg-3)] animate-pulse" />
              <div className="h-3 w-36 rounded bg-[var(--c-bg-3)] animate-pulse" style={{ opacity: 0.6 }} />
            </div>
          </div>
          <div className="mt-3 h-8 rounded-lg bg-[var(--c-bg-3)] animate-pulse" />
        </div>
        {[1, 2].map((i) => (
          <div key={i} className="rounded-xl border px-4 py-3.5" style={{ borderColor: 'var(--c-line)', backgroundColor: 'var(--c-surface)' }}>
            <div className="h-3.5 w-36 rounded bg-[var(--c-bg-3)] animate-pulse mb-3" />
            {[1, 2, 3].map((j) => (
              <div key={j} className="flex items-center justify-between py-1.5">
                <div className="h-3 w-24 rounded bg-[var(--c-bg-3)] animate-pulse" />
                <div className="h-3 w-20 rounded bg-[var(--c-bg-3)] animate-pulse" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--c-bg)' }}>
      <div className="flex shrink-0 items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--c-line)', backgroundColor: 'var(--c-surface)' }}>
        <button type="button" onClick={() => useSemaGuide.getState().clearSecondaryView()} aria-label="Back" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[var(--hover-1)] transition" style={{ color: 'var(--c-fg-dim)' }}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <h2 className="text-[14px] font-bold" style={{ color: 'var(--c-fg)' }}>About Sema Guide</h2>
          <p className="text-[11px]" style={{ color: 'var(--c-fg-muted)' }}>Zoiko Sema</p>
        </div>
        <button type="button" onClick={() => useSemaGuide.getState().closePanel()} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[var(--hover-1)] transition" style={{ color: 'var(--c-fg-dim)' }}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-full mb-3" style={{ backgroundColor: 'var(--c-danger-soft)' }}>
          <AlertCircle className="h-6 w-6" style={{ color: 'var(--c-danger)' }} />
        </div>
        <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--c-fg)' }}>Failed to load</p>
        <p className="text-[12px] mb-4 max-w-[260px]" style={{ color: 'var(--c-fg-dim)' }}>{message || 'Could not load about information. Please try again.'}</p>
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-semibold text-white transition" style={{ backgroundColor: 'var(--c-accent)' }}>
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="rounded-xl border px-4 py-3.5" style={{ borderColor: 'var(--c-line)', backgroundColor: 'var(--c-surface)' }}>
      <h3 className="mb-2.5 text-[13px] font-bold" style={{ color: 'var(--c-fg)' }}>{title}</h3>
      {children}
    </div>
  )
}

function Row({ label, value, valueColor }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[12.5px]" style={{ color: 'var(--c-fg-dim)' }}>{label}</span>
      <span className="text-[12.5px] font-medium text-right max-w-[55%]" style={{ color: valueColor || 'var(--c-fg)' }}>{value}</span>
    </div>
  )
}

function CapabilityItem({ icon, label, desc }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5">{icon}</div>
      <div>
        <p className="text-[12px] font-medium" style={{ color: 'var(--c-fg)' }}>{label}</p>
        <p className="text-[11px]" style={{ color: 'var(--c-fg-dim)' }}>{desc}</p>
      </div>
    </div>
  )
}

function SupportStatusBadge({ status }) {
  if (!status) return null
  const configs = {
    email_sending: { bg: '#FEF3C7', color: '#92400E', label: 'Sending confirmation...' },
    email_sent: { bg: '#ECFDF5', color: '#065F46', label: 'Awaiting specialist' },
    waiting_for_specialist: { bg: '#FFF7ED', color: '#9A3412', label: 'Waiting for specialist' },
    specialist_assigned: { bg: '#EEF2FF', color: '#3730A3', label: 'Specialist assigned' },
    active_chat: { bg: '#ECFDF5', color: '#065F46', label: 'Active chat' },
    closed: { bg: '#F3F4F6', color: '#6B7280', label: 'Closed' },
    failed: { bg: '#FEF2F2', color: '#991B1B', label: 'Failed' },
  }
  const cfg = configs[status] || { bg: '#F3F4F6', color: '#6B7280', label: status }
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600, background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  )
}

function SupportCard({ supportState }) {
  const { ticketId, status, submittedAt, confirmationEmailSent, userEmail } = supportState
  if (!ticketId) return null

  const formattedDate = submittedAt
    ? new Date(submittedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <div className="rounded-xl border px-4 py-4 space-y-3" style={{ borderColor: '#D1FAE5', backgroundColor: '#F0FDF6' }}>
      <div className="flex items-center gap-2">
        <div className="grid h-7 w-7 place-items-center rounded-full" style={{ backgroundColor: '#D1FAE5' }}>
          <CheckCircle2 className="h-4 w-4" style={{ color: '#059669' }} />
        </div>
        <span className="text-[13px] font-bold" style={{ color: '#065F46' }}>Support request submitted</span>
      </div>
      <div className="space-y-2 pl-9">
        <div>
          <span className="text-[11px] font-semibold" style={{ color: '#6B7280' }}>Ticket: </span>
          <span className="text-[13px] font-semibold font-mono" style={{ color: '#4B3DD4' }}>{ticketId}</span>
        </div>
        {confirmationEmailSent && userEmail && (
          <div className="flex items-start gap-1.5">
            <Mail className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: '#6B7280' }} />
            <div>
              <p className="text-[11px]" style={{ color: '#6B7280' }}>Confirmation email sent to:</p>
              <p className="text-[12px] font-medium" style={{ color: '#374151' }}>{userEmail}</p>
            </div>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" style={{ color: '#6B7280' }} />
          <span className="text-[11px]" style={{ color: '#6B7280' }}>Submitted {formattedDate}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold" style={{ color: '#6B7280' }}>Current status:</span>
          <SupportStatusBadge status={status} />
        </div>
        <p className="text-[11px]" style={{ color: '#6B7280' }}>
          <span className="font-semibold">Expected response:</span> Within 24 hours
        </p>
      </div>
    </div>
  )
}

export default function AboutGuide() {
  const { toast } = useToast()
  const { clearSecondaryView, closePanel, aboutData, aboutLoading, aboutError, fetchAboutGuide, requestHandoff, supportState } = useSemaGuide()
  const { ticketId, status, requesting } = supportState
  const hasActiveTicket = !!ticketId && status !== 'closed' && status !== 'failed'

  const handleTalkToPerson = useCallback(() => {
    if (hasActiveTicket) {
      toast({ variant: 'info', title: 'Support request already submitted', description: `Ticket ${ticketId} is ${status === 'email_sent' ? 'awaiting specialist' : 'in progress'}.` })
      return
    }
    requestHandoff()
    toast({ variant: 'success', title: 'Support request submitted', description: 'Confirmation email sent.' })
  }, [requestHandoff, toast, hasActiveTicket, ticketId, status])

  useEffect(() => {
    fetchAboutGuide()
  }, [fetchAboutGuide])

  if (aboutLoading && !aboutData) return <LoadingSkeleton />
  if (aboutError && !aboutData) return <ErrorState message={aboutError} onRetry={fetchAboutGuide} />
  if (!aboutData) return <LoadingSkeleton />

  const d = aboutData

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--c-bg)' }}>
      <div className="flex shrink-0 items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--c-line)', backgroundColor: 'var(--c-surface)' }}>
        <button type="button" onClick={clearSecondaryView} aria-label="Back to conversation" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[var(--hover-1)] transition" style={{ color: 'var(--c-fg-dim)' }}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <h2 className="text-[14px] font-bold" style={{ color: 'var(--c-fg)' }}>About Sema Guide</h2>
          <p className="text-[11px]" style={{ color: 'var(--c-fg-muted)' }}>Zoiko Sema</p>
        </div>
        <button type="button" onClick={closePanel} aria-label="Close Sema Guide" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[var(--hover-1)] transition" style={{ color: 'var(--c-fg-dim)' }}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* Identity Hero */}
        <div className="rounded-xl border px-4 py-4" style={{ borderColor: 'var(--c-line)', backgroundColor: 'var(--c-surface)' }}>
          <div className="flex items-center gap-3">
            <img src={favicon} alt="" width={36} height={36} className="rounded" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[16px] font-bold" style={{ color: 'var(--c-fg)' }}>{d.identity_name}</span>
                <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide" style={{ backgroundColor: 'var(--c-accent-soft)', color: 'var(--c-accent)' }}>AI</span>
              </div>
              <p className="text-[12px] mt-0.5" style={{ color: 'var(--c-fg-dim)' }}>{d.identity_description}</p>
            </div>
          </div>
          {d.identity_notice && (
            <div className="mt-3 rounded-lg px-3 py-2 text-[12px]" style={{ backgroundColor: 'var(--c-accent-soft)', color: 'var(--c-fg-dim)' }}>
              {d.identity_notice}
            </div>
          )}
          <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--c-fg-dim)' }}>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            {d.status}
            <span className="mx-1">·</span>
            Managed by {d.managed_by}
          </div>
        </div>

        {/* What Sema Guide Can Do */}
        {d.capabilities?.length > 0 && (
          <Section title="What Sema Guide can do now">
            <div className="space-y-2">
              {d.capabilities.map((cap, i) => (
                <CapabilityItem key={i} icon={<Sparkles className="h-3.5 w-3.5" style={{ color: 'var(--c-success)' }} />} label={cap.label} desc={cap.description} />
              ))}
            </div>
          </Section>
        )}

        {/* Information Access */}
        {d.info_access_rows?.length > 0 && (
          <Section title="Information access — current session">
            {d.info_access_rows.map((row, i) => (
              <Row key={i} label={row.label} value={row.value} valueColor={row.value_color} />
            ))}
            {d.info_access_disclaimer && (
              <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--c-line)' }}>
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--c-fg-dim)' }}>{d.info_access_disclaimer}</p>
              </div>
            )}
          </Section>
        )}

        {/* Actions and Authorization */}
        {d.actions_auth && (
          <Section title="Actions and authorization">
            <p className="text-[12px]" style={{ color: 'var(--c-fg-dim)' }}>{d.actions_auth}</p>
          </Section>
        )}

        {/* Limitations */}
        {d.limitations && (
          <Section title="Important limitations">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: 'var(--c-warn)' }} />
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--c-fg-dim)' }}>{d.limitations}</p>
            </div>
          </Section>
        )}

        {/* Human Support */}
        {d.human_support_message && (
          <Section title="Human support">
            <p className="text-[12px]" style={{ color: 'var(--c-fg-dim)' }}>{d.human_support_message}</p>
            {d.human_support_enabled && (
              <div className="mt-3 space-y-3">
                <button
                  type="button"
                  onClick={handleTalkToPerson}
                  disabled={requesting}
                  className="w-full rounded-lg px-3 py-2 text-[12px] font-semibold text-white transition disabled:opacity-50"
                  style={{ backgroundColor: 'var(--c-accent)' }}
                >
                  {requesting ? 'Requesting...' : hasActiveTicket ? 'Contact support' : 'Talk to a person'}
                </button>
                {hasActiveTicket && <SupportCard supportState={supportState} />}
              </div>
            )}
          </Section>
        )}

        {/* Governance */}
        {d.governance_rows?.length > 0 && (
          <Section title="Governance">
            {d.governance_rows.map((row, i) => (
              <Row key={i} label={row.label} value={row.value} valueColor={row.value_color} />
            ))}
          </Section>
        )}

        {/* Service Information */}
        {d.service_info_rows?.length > 0 && (
          <Section title="Service information">
            {d.service_info_rows.map((row, i) => (
              <Row key={i} label={row.label} value={row.value} valueColor={row.value_color} />
            ))}
          </Section>
        )}

        {/* Links */}
        {d.links?.length > 0 && (
          <div className="flex flex-wrap gap-2 pb-4">
            {d.links.map((link, i) => {
              const isUnavailable = !link.url || link.url === '#'
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    if (isUnavailable) {
                      toast({ variant: 'info', title: 'Unavailable', description: 'This page is coming soon.' })
                    } else {
                      window.open(link.url, '_blank', 'noopener,noreferrer')
                    }
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-medium underline-offset-2 hover:underline disabled:cursor-not-allowed transition"
                  // opacity:1 overrides the global `button:disabled { opacity:0.5 }`
                  // in index.css so these "coming soon" buttons stay 100% visible.
                  style={{ color: isUnavailable ? 'var(--c-fg)' : 'var(--c-accent)', opacity: 1 }}
                  disabled={isUnavailable}
                >
                  <ExternalLink className="h-3 w-3" /> {link.label}
                  {isUnavailable && (
                    <span className="text-[10px] ml-0.5" style={{ color: 'var(--c-accent)' }}>(coming soon)</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
