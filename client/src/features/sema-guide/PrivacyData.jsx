import { useEffect, useState, useCallback } from 'react'
import { ArrowLeft, X, Shield, Database, Brain, Users, Sliders, FileText, CheckCircle, ExternalLink, Lock, Info, RefreshCw, AlertCircle, Loader2, Send, ChevronDown, ChevronUp } from 'lucide-react'
import { useSemaGuide } from './store'
import { useToast } from '../../components/ui/Toast'

function TrashIcon({ color = '#DC2626' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

function Spinner() {
  return <Loader2 className="h-3.5 w-3.5 animate-spin" />
}

const CONTROL_ICONS = {
  'file-text': FileText,
  'trash': TrashIcon,
  'sliders': Sliders,
  'users': Users,
  'shield': Shield,
}

const PURPOSE_ICONS = { 'check': CheckCircle, 'info': Info }

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
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border px-4 py-3.5" style={{ borderColor: 'var(--c-line)', backgroundColor: 'var(--c-surface)' }}>
            <div className="h-3.5 w-32 rounded bg-[var(--c-bg-3)] animate-pulse mb-3" />
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
          <h2 className="text-[14px] font-bold" style={{ color: 'var(--c-fg)' }}>Privacy & data</h2>
          <p className="text-[11px]" style={{ color: 'var(--c-fg-muted)' }}>Sema Guide</p>
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
        <p className="text-[12px] mb-4 max-w-[260px]" style={{ color: 'var(--c-fg-dim)' }}>{message || 'Could not load privacy data. Please try again.'}</p>
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-semibold text-white transition" style={{ backgroundColor: 'var(--c-accent)' }}>
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      </div>
    </div>
  )
}

function ToggleRow({ label, checked, onChange, disabled }) {
  return (
    <label className="flex items-center justify-between py-2 cursor-pointer">
      <span className="text-[12px]" style={{ color: disabled ? 'var(--c-fg-muted)' : 'var(--c-fg)' }}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        className="relative h-5 w-9 shrink-0 rounded-full transition-colors"
        style={{
          backgroundColor: checked ? 'var(--c-accent)' : 'var(--c-bg-3)',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span
          className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform shadow-sm"
          style={{ transform: checked ? 'translateX(14px)' : 'translateX(0)' }}
        />
      </button>
    </label>
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

export default function PrivacyData() {
  const { toast } = useToast()
  const {
    clearSecondaryView, closePanel, privacyData, privacyLoading, privacyError,
    fetchPrivacyContext, downloadConversation, deleteConversation,
    fetchPrivacyPrefs, fetchSharingPrefs,
    updatePrivacyPrefs, updateSharingPrefs, submitPrivacyRequest,
    privacyActionLoading,
  } = useSemaGuide()

  const [expandedPanel, setExpandedPanel] = useState(null)
  const [prefValues, setPrefValues] = useState({ improvement_opt_in: false, quality_review_opt_in: false, product_research_opt_in: false })
  const [sharingValues, setSharingValues] = useState({ share_with_workspace: false, share_for_training: false, share_with_support: true })
  const [requestType, setRequestType] = useState('access')
  const [requestDetails, setRequestDetails] = useState('')

  useEffect(() => { fetchPrivacyContext() }, [fetchPrivacyContext])

  const handleDownload = useCallback(async () => {
    const result = await downloadConversation()
    toast({ variant: result.success ? 'success' : 'error', title: result.success ? 'Downloaded' : 'Download failed', description: result.message })
  }, [downloadConversation, toast])

  const handleDelete = useCallback(async () => {
    if (!window.confirm('Permanently delete this entire conversation? This action cannot be undone.')) return
    const result = await deleteConversation()
    toast({ variant: result.success ? 'success' : 'error', title: result.success ? 'Deleted' : 'Delete failed', description: result.message })
  }, [deleteConversation, toast])

  const togglePanel = useCallback(async (panel) => {
    setExpandedPanel((prev) => {
      const next = prev === panel ? null : panel
      if (panel === 'prefs' && next === 'prefs') {
        fetchPrivacyPrefs().then((prefs) => { if (prefs) setPrefValues(prefs) })
      } else if (panel === 'sharing' && next === 'sharing') {
        fetchSharingPrefs().then((prefs) => { if (prefs) setSharingValues(prefs) })
      }
      return next
    })
  }, [fetchPrivacyPrefs, fetchSharingPrefs])

  const handleSavePrefs = useCallback(async () => {
    const result = await updatePrivacyPrefs(prefValues)
    toast({ variant: result.success ? 'success' : 'error', title: result.success ? 'Saved' : 'Save failed', description: result.message })
  }, [updatePrivacyPrefs, prefValues, toast])

  const handleSaveSharing = useCallback(async () => {
    const result = await updateSharingPrefs(sharingValues)
    toast({ variant: result.success ? 'success' : 'error', title: result.success ? 'Saved' : 'Save failed', description: result.message })
  }, [updateSharingPrefs, sharingValues, toast])

  const handleSubmitRequest = useCallback(async () => {
    if (!requestDetails.trim()) {
      toast({ variant: 'warning', title: 'Details required', description: 'Please describe your request.' })
      return
    }
    const result = await submitPrivacyRequest({ request_type: requestType, details: requestDetails })
    if (result.status === 'submitted') {
      toast({ variant: 'success', title: 'Request submitted', description: result.message })
      setRequestDetails('')
      setExpandedPanel(null)
    } else {
      toast({ variant: 'error', title: 'Submission failed', description: result.message || 'Please try again.' })
    }
  }, [submitPrivacyRequest, requestType, requestDetails, toast])

  if (privacyLoading && !privacyData) return <LoadingSkeleton />
  if (privacyError && !privacyData) return <ErrorState message={privacyError} onRetry={fetchPrivacyContext} />
  if (!privacyData) return <LoadingSkeleton />

  const d = privacyData

  const isBusy = (id) => privacyActionLoading === id

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--c-bg)' }}>
      <div className="flex shrink-0 items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--c-line)', backgroundColor: 'var(--c-surface)' }}>
        <button type="button" onClick={clearSecondaryView} aria-label="Back to conversation" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[var(--hover-1)] transition" style={{ color: 'var(--c-fg-dim)' }}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <h2 className="text-[14px] font-bold" style={{ color: 'var(--c-fg)' }}>Privacy & data</h2>
          <p className="text-[11px]" style={{ color: 'var(--c-fg-muted)' }}>Sema Guide</p>
        </div>
        <button type="button" onClick={closePanel} aria-label="Close Sema Guide" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[var(--hover-1)] transition" style={{ color: 'var(--c-fg-dim)' }}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--c-fg-dim)' }}>See what Sema Guide is using, how long information is retained and which controls are available to you.</p>

        {d.current_session_rows?.length > 0 && (
          <Section title="Current session">
            {d.current_session_rows.map((row, i) => (
              <Row key={i} label={row.label} value={row.value} valueColor={row.value_color} />
            ))}
            {d.current_session_disclaimer && (
              <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--c-line)' }}>
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--c-fg-dim)' }}>{d.current_session_disclaimer}</p>
              </div>
            )}
          </Section>
        )}

        {d.usage_purposes?.length > 0 && (
          <Section title="How your information is used">
            <div className="space-y-2">
              {d.usage_purposes.map((p, i) => {
                const Icon = PURPOSE_ICONS[p.icon] || Info
                const bg = p.enabled ? 'var(--c-accent-soft)' : 'var(--c-bg-3)'
                const iconColor = p.enabled ? 'var(--c-accent)' : 'var(--c-fg-muted)'
                const titleColor = p.enabled ? 'var(--c-fg)' : 'var(--c-fg-muted)'
                const descColor = p.enabled ? 'var(--c-fg-dim)' : 'var(--c-fg-muted)'
                return (
                  <div key={i} className="flex items-start gap-2">
                    <div className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded" style={{ backgroundColor: bg }}>
                      <Icon className="h-2.5 w-2.5" style={{ color: iconColor }} />
                    </div>
                    <div>
                      <p className="text-[12px] font-medium" style={{ color: titleColor }}>{p.title}</p>
                      <p className="text-[11px]" style={{ color: descColor }}>{p.description}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>
        )}

        {d.storage_retention_rows?.length > 0 && (
          <Section title="Storage and retention">
            {d.storage_retention_rows.map((row, i) => (
              <Row key={i} label={row.label} value={row.value} valueColor={row.value_color} />
            ))}
            {d.storage_policy && (
              <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--c-line)' }}>
                <p className="text-[11px]" style={{ color: 'var(--c-fg-dim)' }}>{d.storage_policy}</p>
              </div>
            )}
          </Section>
        )}

        {d.ai_model_use_rows?.length > 0 && (
          <Section title="AI model use">
            {d.ai_model_use_rows.map((row, i) => (
              <Row key={i} label={row.label} value={row.value} valueColor={row.value_color} />
            ))}
          </Section>
        )}

        {d.human_support_message && (
          <Section title="Human support">
            <p className="text-[12px]" style={{ color: 'var(--c-fg-dim)' }}>{d.human_support_message}</p>
          </Section>
        )}

        {d.privacy_controls?.length > 0 && (
          <Section title="Your privacy controls">
            {d.privacy_controls.map((ctl, i) => {
              const Icon = CONTROL_ICONS[ctl.icon] || Shield
              const isDelete = ctl.icon === 'trash'
              const actionId = ctl.id === 'download' ? 'download' : ctl.id === 'delete' ? 'delete' : null
              const busy = actionId !== null && isBusy(actionId)

              const handleClick = () => {
                if (ctl.id === 'download') handleDownload()
                else if (ctl.id === 'delete') handleDelete()
                else if (ctl.id === 'manage-optional') togglePanel('prefs')
                else if (ctl.id === 'manage-sharing') togglePanel('sharing')
                else if (ctl.id === 'privacy-request') togglePanel('request')
              }

              const isExpander = ['manage-optional', 'manage-sharing', 'privacy-request'].includes(ctl.id)
              const isOpen = expandedPanel === (ctl.id === 'manage-optional' ? 'prefs' : ctl.id === 'manage-sharing' ? 'sharing' : 'request')

              return (
                <div key={i}>
                  <button
                    type="button"
                    onClick={handleClick}
                    disabled={busy}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[12px] font-medium text-left transition hover:bg-[var(--hover-1)] disabled:opacity-50"
                    style={{ color: ctl.color || 'var(--c-fg)', background: 'transparent', border: 'none', boxShadow: 'none' }}
                  >
                    {busy ? (
                      <Spinner />
                    ) : isDelete ? (
                      <TrashIcon color={ctl.color || 'var(--c-danger)'} />
                    ) : (
                      <Icon className="h-4 w-4 shrink-0" style={{ color: ctl.color || 'var(--c-fg-dim)' }} />
                    )}
                    <span className="flex-1">{ctl.label}</span>
                    {isExpander && (
                      isOpen ? <ChevronUp className="h-3.5 w-3.5" style={{ color: 'var(--c-fg-muted)' }} /> : <ChevronDown className="h-3.5 w-3.5" style={{ color: 'var(--c-fg-muted)' }} />
                    )}
                  </button>

                  {/* Inline: Manage optional data uses */}
                  {ctl.id === 'manage-optional' && expandedPanel === 'prefs' && (
                    <div className="mx-3 mb-2 mt-1 rounded-lg border p-3 space-y-1" style={{ borderColor: 'var(--c-line)', backgroundColor: 'var(--c-bg-2)' }}>
                      <ToggleRow label="Allow improvement of Sema Guide" checked={prefValues.improvement_opt_in} onChange={(v) => setPrefValues((p) => ({ ...p, improvement_opt_in: v }))} />
                      <ToggleRow label="Allow human quality review" checked={prefValues.quality_review_opt_in} onChange={(v) => setPrefValues((p) => ({ ...p, quality_review_opt_in: v }))} />
                      <ToggleRow label="Allow product research use" checked={prefValues.product_research_opt_in} onChange={(v) => setPrefValues((p) => ({ ...p, product_research_opt_in: v }))} />
                      <button
                        type="button"
                        onClick={handleSavePrefs}
                        disabled={isBusy('prefs')}
                        className="mt-2 w-full rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white transition disabled:opacity-50"
                        style={{ backgroundColor: 'var(--c-accent)' }}
                      >
                        {isBusy('prefs') ? 'Saving...' : 'Save preferences'}
                      </button>
                    </div>
                  )}

                  {/* Inline: Manage support-sharing preferences */}
                  {ctl.id === 'manage-sharing' && expandedPanel === 'sharing' && (
                    <div className="mx-3 mb-2 mt-1 rounded-lg border p-3 space-y-1" style={{ borderColor: 'var(--c-line)', backgroundColor: 'var(--c-bg-2)' }}>
                      <ToggleRow label="Share with workspace admins" checked={sharingValues.share_with_workspace} onChange={(v) => setSharingValues((p) => ({ ...p, share_with_workspace: v }))} />
                      <ToggleRow label="Share for model training" checked={sharingValues.share_for_training} onChange={(v) => setSharingValues((p) => ({ ...p, share_for_training: v }))} />
                      <ToggleRow label="Share with support team" checked={sharingValues.share_with_support} onChange={(v) => setSharingValues((p) => ({ ...p, share_with_support: v }))} />
                      <button
                        type="button"
                        onClick={handleSaveSharing}
                        disabled={isBusy('sharing')}
                        className="mt-2 w-full rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white transition disabled:opacity-50"
                        style={{ backgroundColor: 'var(--c-accent)' }}
                      >
                        {isBusy('sharing') ? 'Saving...' : 'Save preferences'}
                      </button>
                    </div>
                  )}

                  {/* Inline: Submit a privacy request */}
                  {ctl.id === 'privacy-request' && expandedPanel === 'request' && (
                    <div className="mx-3 mb-2 mt-1 rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--c-line)', backgroundColor: 'var(--c-bg-2)' }}>
                      <div>
                        <label className="text-[11px] font-medium mb-1 block" style={{ color: 'var(--c-fg-dim)' }}>Request type</label>
                        <select
                          value={requestType}
                          onChange={(e) => setRequestType(e.target.value)}
                          className="w-full rounded-lg px-2.5 py-1.5 text-[12px]"
                          style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-line)', color: 'var(--c-fg)' }}
                        >
                          <option value="access">Access my data</option>
                          <option value="deletion">Delete my data</option>
                          <option value="portability">Port my data</option>
                          <option value="objection">Object to processing</option>
                          <option value="restriction">Restrict processing</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] font-medium mb-1 block" style={{ color: 'var(--c-fg-dim)' }}>Details</label>
                        <textarea
                          value={requestDetails}
                          onChange={(e) => setRequestDetails(e.target.value)}
                          placeholder="Describe your request..."
                          rows={3}
                          className="w-full rounded-lg px-2.5 py-1.5 text-[12px] resize-none"
                          style={{ backgroundColor: 'var(--c-surface)', borderColor: 'var(--c-line)', color: 'var(--c-fg)' }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleSubmitRequest}
                        disabled={isBusy('request')}
                        className="w-full rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white transition disabled:opacity-50"
                        style={{ backgroundColor: 'var(--c-accent)' }}
                      >
                        {isBusy('request') ? 'Submitting...' : 'Submit request'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </Section>
        )}

        {d.policy_links?.length > 0 && (
          <div className="flex flex-wrap gap-2 pb-4">
            {d.policy_links.map((link, i) => {
              const isUnavailable = !link.url || link.url === '#'
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    if (isUnavailable) {
                      console.warn(`Policy link not yet available: ${link.label}`)
                      toast({ variant: 'info', title: 'Unavailable', description: 'This page is currently unavailable.' })
                    } else {
                      window.open(link.url, '_blank', 'noopener,noreferrer')
                    }
                  }}
                  aria-label={link.label}
                  disabled={isUnavailable}
                  className="inline-flex items-center gap-1 text-[11px] font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  style={{ color: isUnavailable ? 'var(--c-fg-muted)' : 'var(--c-accent)' }}
                >
                  <ExternalLink className="h-3 w-3" /> {link.label}
                  {isUnavailable && (
                    <span className="text-[10px] ml-0.5" style={{ color: 'var(--c-fg-muted)' }}>(coming soon)</span>
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
