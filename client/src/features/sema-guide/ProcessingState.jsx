import { Loader2 } from 'lucide-react'

export default function ProcessingState({ task }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-[var(--c-line)] bg-[var(--c-bg-2)] px-3.5 py-2.5 self-start">
      <Loader2 className="h-4 w-4 animate-spin text-[var(--c-accent)]" />
      <span className="text-[12.5px] text-[var(--c-fg-dim)]">
        {task || 'Processing…'}
      </span>
    </div>
  )
}
