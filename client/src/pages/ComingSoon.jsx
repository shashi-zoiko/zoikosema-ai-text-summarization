import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Sparkles, Wrench } from 'lucide-react'
import Button from '../components/ui/Button'

/* ─────────────────────────────────────────────────────────────────────────
 * ComingSoon — a neutral placeholder for features that are still under
 * development. Used by routes like /analytics and /ai-summaries so the nav
 * entries point somewhere honest instead of silently redirecting the user to
 * an unrelated active page (which read as a bug during QA). Reads off the
 * shared design tokens so it tracks light/dark automatically.
 * ──────────────────────────────────────────────────────────────────────── */
export default function ComingSoon({ feature = 'This feature', description }) {
  const navigate = useNavigate()

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-1 items-center justify-center px-6 py-16 sm:px-12">
      <div className="w-full max-w-[520px] text-center">
        <div className="relative mx-auto mb-6 grid h-16 w-16 place-items-center rounded-2xl bg-[var(--c-accent-soft)] text-[var(--c-accent)]">
          <Wrench className="h-7 w-7" />
          <span
            aria-hidden
            className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-[var(--c-accent)] text-white shadow-[0_4px_10px_-3px_var(--c-accent-ring)]"
          >
            <Sparkles className="h-3.5 w-3.5" />
          </span>
        </div>

        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--c-bg-3)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--c-fg-muted)]">
          Coming soon
        </span>

        <h1 className="mt-4 text-[28px] font-bold tracking-[-0.03em] text-[var(--c-fg)]">
          {feature}
        </h1>
        <p className="mx-auto mt-2 max-w-[420px] text-[14.5px] leading-relaxed text-[var(--c-fg-muted)]">
          {description || `${feature} is under active development and isn’t available just yet. It will show up here the moment it ships.`}
        </p>

        <div className="mt-7 flex items-center justify-center gap-2.5">
          <Button variant="secondary" size="sm" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate(-1)}>
            Go back
          </Button>
          <Button variant="primary" size="sm" onClick={() => navigate('/')}>
            Back to home
          </Button>
        </div>
      </div>
    </div>
  )
}
