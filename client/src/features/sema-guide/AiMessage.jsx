import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CheckCircle, Sparkles } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useSemaGuide } from './store'

function stripCitations(text) {
  return text
    .replace(/\s*\(#\d+\)/g, '')
    // parenthesised "(Source: …)" citation, incl. a wrapped markdown link like
    // "([Source: …](url))" (leading-bracket/emphasis tolerance, one nested paren).
    .replace(/\s*\((?:[[*_\s]*)sources?\s*:(?:[^()]|\([^()]*\))*\)/gi, '')
    // bare bracketed citation labels ("[Help Center]", "[Product Documentation]",
    // "[Approved … documentation]") that are not real markdown links.
    .replace(/\s*\[\s*(?:help\s*cent(?:er|re)|product\s+documentation|approved[^\]]*document[^\]]*)\s*\](?!\()/gi, '')
    // trailing "Source:" / "[Source:" / "Source 1:" citation block to end of reply,
    // covering the bracketed, numbered and double-bracketed forms.
    .replace(/(?:^|\n)[ \t]*\[?[ \t]*\**[ \t]*sources?\**[ \t]*\d*[ \t]*:[\s\S]*$/i, '')
    // drop any line leaking the internal knowledge-precedence hierarchy (mirrors
    // the server-side guardrails.sanitize_output) so already-persisted replies
    // that still contain it clean up on display too.
    .replace(/^.*(?:knowledge precedence|live tenant policy|live entitlement|curated external vendor documentation|approved support procedures and integration|general model knowledge).*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export default function AiMessage({ content, verified = false, actionPreview = null }) {
  const cleanContent = stripCitations(content)

  return (
    <div className="flex max-w-[90%] flex-col gap-1.5 self-start">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[var(--c-accent)] to-[var(--c-accent-2)] text-white shadow-[0_2px_8px_-2px_var(--c-accent-ring)]">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <span className="text-[11px] text-[var(--c-fg-muted)]">Sema Guide</span>
      </div>

      <div className={cn(
        'rounded-2xl rounded-tl-sm px-4 py-3 text-[14px] leading-relaxed',
        'border border-[var(--c-line)] bg-[var(--c-bg-2)] text-[var(--c-fg)]'
      )}>
        <div className="sg-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {cleanContent}
          </ReactMarkdown>
        </div>
      </div>

      {verified && (
        <div className="flex items-center gap-1.5 px-1">
          <CheckCircle className="h-[14px] w-[14px] text-emerald-500" />
          <span className="text-[11px] font-medium text-emerald-500">Verified</span>
        </div>
      )}

      {actionPreview && (
        <ActionPreviewCard preview={actionPreview} />
      )}
    </div>
  )
}

const markdownComponents = {
  h1: ({ children }) => <h1 className="mb-3 mt-4 text-[18px] font-bold leading-tight text-[var(--c-fg)] first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-4 text-[16px] font-bold leading-tight text-[var(--c-fg)] first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-3 text-[15px] font-semibold leading-tight text-[var(--c-fg)] first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed" style={{ lineHeight: 1.65 }}>{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="pl-1 text-[var(--c-fg)]">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-[var(--c-fg)]">{children}</strong>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--c-accent)] underline underline-offset-2 transition hover:brightness-110">
      {children}
    </a>
  ),
  code: ({ children }) => <code className="rounded-md bg-[var(--c-bg-3)] px-1.5 py-0.5 text-[12.5px] font-medium text-[var(--c-accent)]">{children}</code>,
  hr: () => <hr className="my-4 border-t border-[var(--c-line)]" />,
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-[var(--c-accent)] pl-3 text-[var(--c-fg-dim)] italic last:mb-0">{children}</blockquote>
  ),
}

function ActionPreviewCard({ preview }) {
  const { sendMessage } = useSemaGuide()

  const handleConfirm = () => {
    sendMessage(`Confirm action: ${preview.title || preview.object || ''}`.trim())
  }

  const handleEdit = () => {
    sendMessage(`I want to modify this action: ${preview.title || preview.object || ''}`.trim())
  }

  const handleCancel = () => {
    sendMessage('Cancel the proposed action.'.trim())
  }

  return (
    <div className="mt-1 rounded-xl border border-[var(--c-line-strong)] bg-[var(--c-surface)] p-3 shadow-sm">
      <h4 className="mb-2 text-[12px] font-semibold">{preview.title || 'Confirm action'}</h4>

      <div className="space-y-1.5 text-[12px]">
        {preview.object && (
          <DetailRow label="Target" value={preview.object} />
        )}
        {preview.before && preview.after && (
          <>
            <DetailRow label="Current" value={preview.before} />
            <DetailRow label="After change" value={preview.after} />
          </>
        )}
        {preview.people_affected != null && (
          <DetailRow label="People affected" value={String(preview.people_affected)} />
        )}
        {preview.notifications && (
          <DetailRow label="Notifications" value={preview.notifications} />
        )}
        {preview.consequence && (
          <DetailRow label="Impact" value={preview.consequence} />
        )}
        {preview.reversible != null && (
          <DetailRow
            label="Reversible"
            value={preview.reversible ? `Yes — for ${preview.reversible_duration || 'a limited time'}` : 'No'}
          />
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={handleConfirm}
          className="flex-1 rounded-lg bg-[var(--c-accent)] px-3 py-2 text-[12px] font-semibold text-white transition hover:brightness-110"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={handleEdit}
          className="flex-1 rounded-lg border border-[var(--c-line-strong)] bg-[var(--c-bg-2)] px-3 py-2 text-[12px] font-medium text-[var(--c-fg-dim)] transition hover:bg-[var(--c-bg-3)]"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="rounded-lg border border-[var(--c-line-strong)] bg-[var(--c-bg-2)] px-3 py-2 text-[12px] font-medium text-[var(--c-fg-dim)] transition hover:bg-[var(--c-danger-soft)] hover:text-[var(--c-danger)]"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="shrink-0 text-[var(--c-fg-muted)]">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}
