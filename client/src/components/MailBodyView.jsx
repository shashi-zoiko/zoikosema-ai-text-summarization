import { useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { api, getApiBase, getAuthToken } from '../api/client'

/* Phase 3 slice 4 — mail rendering/sanitization pipeline.
 *
 * Two independent sanitizers, not one: the server already ran this same
 * HTML through nh3 (Rust/Ammonia) before it ever reached the browser; this
 * component runs it through DOMPurify again right before DOM insertion.
 * A working exploit has to defeat both, in two different languages/parsers,
 * to reach the third net below (image proxying + no `<script>`/`on*`/
 * `javascript:` surviving either pass).
 *
 * No iframe/sandbox: that tradeoff only paid for itself when frontend
 * sanitize was the sole line of defense. With backend nh3 sanitizing first,
 * a sandboxed div is enough for "no script execution" without the layout/
 * dark-mode/copy-paste cost an iframe adds (see plans/sema-p3-s4-*.md).
 *
 * Remote <img> tags are never given the sender's original URL directly —
 * that would leak the viewer's IP to whatever host sent the email. Instead,
 * after sanitizing, each <img src> is fetched through our own authenticated
 * image-proxy endpoint (server resolves/fetches it, the viewer never talks
 * to the remote host) and swapped to a local blob URL. `cid:` (inline
 * attachment) images are intentionally out of scope for this slice — nh3
 * already strips them server-side since `cid` isn't an allowed URL scheme,
 * so they simply render as broken-image + alt text.
 */

const ALLOWED_TAGS = [
  'p', 'br', 'div', 'span', 'a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'img', 'pre', 'code',
  'sub', 'sup', 'small', 'font', 'center',
]

const ALLOWED_ATTR = [
  'style', 'align', 'dir', 'href', 'title', 'target', 'rel',
  'src', 'alt', 'width', 'height', 'colspan', 'rowspan', 'bgcolor', 'valign',
]

// Matches only http(s)/mailto — same scheme allowlist as the server's nh3
// pass, so `javascript:`/`data:`/`cid:` etc. never survive either sanitizer.
const ALLOWED_URI_REGEXP = /^(?:https?|mailto):/i

function sanitize(html) {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
  })
}

/** Swap every <img src="https://..."> under `root` for an authenticated,
 *  proxied blob URL. Returns a cleanup function that revokes the blob URLs. */
function proxyRemoteImages(root) {
  const apiBase = getApiBase()
  const token = getAuthToken()
  const objectUrls = []

  const imgs = Array.from(root.querySelectorAll('img[src]'))
  imgs.forEach(async (img) => {
    const originalSrc = img.getAttribute('src')
    if (!/^https?:\/\//i.test(originalSrc)) return // cid:/relative/already-stripped — leave as broken-image
    try {
      const res = await fetch(
        `${apiBase}/api/mail/image-proxy?url=${encodeURIComponent(originalSrc)}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      )
      if (!res.ok) return
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      objectUrls.push(objectUrl)
      img.setAttribute('src', objectUrl)
    } catch {
      // best-effort — broken image + alt text is an acceptable fallback
    }
  })

  return () => objectUrls.forEach((u) => URL.revokeObjectURL(u))
}

export default function MailBodyView({ messageId }) {
  // Keyed by messageId rather than reset-in-effect, so there's no direct
  // setState() call in the effect body itself (only inside the async
  // then/catch) — a stale result for a different id is just treated as loading.
  const [result, setResult] = useState({ forId: null, body: null, error: null })
  const containerRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    api(`/api/mail/messages/${encodeURIComponent(messageId)}/body`)
      .then((data) => { if (!cancelled) setResult({ forId: messageId, body: data, error: null }) })
      .catch((err) => { if (!cancelled) setResult({ forId: messageId, body: null, error: err.message }) })
    return () => { cancelled = true }
  }, [messageId])

  const loading = result.forId !== messageId
  const body = loading ? null : result.body
  const error = loading ? null : result.error

  useEffect(() => {
    if (!body?.html || !containerRef.current) return
    return proxyRemoteImages(containerRef.current)
  }, [body])

  if (error) return <div className="text-[13px] text-[var(--c-danger)]">{error}</div>
  if (body === null) return <div className="text-[13px] text-[var(--c-fg-muted)]">Loading…</div>

  return (
    <div>
      {body.html ? (
        <div
          ref={containerRef}
          className="mail-body-view text-[14px] text-[var(--c-fg)]"
          // Sanitized twice (server nh3 + DOMPurify above) before this ever runs.
          dangerouslySetInnerHTML={{ __html: sanitize(body.html) }}
        />
      ) : body.text ? (
        // Plain-text messages never go through dangerouslySetInnerHTML at
        // all — a React text node can't be parsed as markup, so this path
        // needs no sanitizer to be safe by construction.
        <div className="mail-body-view whitespace-pre-wrap text-[14px] text-[var(--c-fg)]">{body.text}</div>
      ) : (
        <div className="text-[13px] text-[var(--c-fg-muted)]">(No content)</div>
      )}

      {body.attachments?.length > 0 && (
        <div className="mt-4 space-y-1.5 border-t border-[var(--c-line)] pt-3">
          <div className="text-[12px] font-medium text-[var(--c-fg-muted)]">
            {body.attachments.length} attachment{body.attachments.length > 1 ? 's' : ''}
          </div>
          {body.attachments.map((a) => (
            <div
              key={a.provider_attachment_id}
              className="flex items-center justify-between rounded-[8px] border border-[var(--c-line-strong)] px-3 py-2 text-[13px]"
            >
              <span className="truncate">{a.filename || '(unnamed)'}</span>
              <span className="ml-3 shrink-0 text-[var(--c-fg-muted)]">{formatBytes(a.size_bytes)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`
}
