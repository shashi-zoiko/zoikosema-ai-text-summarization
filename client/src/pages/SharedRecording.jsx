import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getApiBase } from '../api/client'
import Spinner from '../components/ui/Spinner'

// Public playback for /recording/:token — does NOT require auth so the
// share link works for anyone. The file itself is streamed from the
// /api/recordings/files mount; metadata comes from /api/recordings/shared/:token.
function fmtDuration(secs) {
  if (!secs) return '0:00'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function SharedRecording() {
  const { token } = useParams()
  const [rec, setRec] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    // No auth header — this is a public endpoint by design.
    fetch(`${getApiBase()}/api/recordings/shared/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}))
          throw new Error(data.detail || `HTTP ${r.status}`)
        }
        return r.json()
      })
      .then((data) => { if (!cancelled) setRec(data) })
      .catch((e) => { if (!cancelled) setErr(e.message || 'Link expired') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token])

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <Spinner size="lg" />
      </div>
    )
  }

  if (err || !rec) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Recording unavailable</h1>
          <p style={{ color: 'var(--c-fg-muted, #94a3b8)' }}>{err || 'This share link is no longer valid.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--c-bg-1, #0b0d12)', color: 'var(--c-fg, #f1f5f9)' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 20px' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {rec.meeting_title || 'Meeting recording'}
          </h1>
          <div style={{ marginTop: 6, fontSize: 13, color: 'var(--c-fg-muted, #94a3b8)' }}>
            Shared by {rec.recorder_name || 'a teammate'} · {fmtDuration(rec.duration)} · {fmtSize(rec.file_size)}
          </div>
        </div>

        {rec.file_url && (
          <video
            controls
            autoPlay={false}
            preload="metadata"
            src={`${getApiBase()}${rec.file_url}`}
            style={{
              width: '100%',
              borderRadius: 14,
              background: '#000',
              boxShadow: '0 20px 60px -24px rgba(0,0,0,0.6)',
            }}
          />
        )}

        <div style={{ marginTop: 20, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a
            href={`${getApiBase()}${rec.file_url}`}
            download
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              background: 'var(--c-accent, #1f7a54)',
              color: '#fff',
              fontWeight: 600,
              fontSize: 13,
              textDecoration: 'none',
            }}
          >
            Download recording
          </a>
          {rec.chat_log_url && (
            <a
              href={`${getApiBase()}${rec.chat_log_url}`}
              download
              style={{
                padding: '10px 16px',
                borderRadius: 10,
                border: '1px solid var(--c-line, #1f2330)',
                color: 'var(--c-fg, #f1f5f9)',
                fontWeight: 600,
                fontSize: 13,
                textDecoration: 'none',
              }}
            >
              Download chat log
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
