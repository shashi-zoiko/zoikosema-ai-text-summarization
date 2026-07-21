import { useMemo, useState } from 'react'
import { t } from '../../../lib/i18n.js'
import Modal from '../../../components/ui/Modal.jsx'
import { SHORTCUT_GROUPS, isMacPlatform, keysFor } from './shortcutsRegistry.js'

/**
 * Keyboard shortcuts (ZS-MTG-IMP-03 §12). Read-only, generated from the canonical
 * shortcutsRegistry (no second hardcoded list). Searchable; platform-shaped keys.
 * Presented via the shared Modal. No resources acquired (no timers/listeners/
 * subscriptions beyond Modal's own), so no lifecycle helper is needed.
 */
export default function KeyboardShortcutsDialog({ onClose }) {
  const mac = useMemo(() => isMacPlatform(), [])
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    return SHORTCUT_GROUPS
      .map((g) => ({
        ...g,
        items: g.items.filter((it) => !q || t(it.labelKey).toLowerCase().includes(q)),
      }))
      .filter((g) => g.items.length > 0)
  }, [query])

  return (
    <Modal open onClose={onClose} title={t('meeting.more.support.shortcut.title')} size="sm">
      <div className="space-y-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('meeting.more.support.shortcut.search')}
          aria-label={t('meeting.more.support.shortcut.search')}
          className="w-full rounded-lg border border-[var(--c-line)] bg-[var(--c-bg-2)] px-3 py-2 text-sm text-[var(--c-fg)] outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]/50"
        />
        {groups.length === 0 && (
          <p className="py-4 text-center text-[13px] text-[var(--c-fg-muted)]">{t('meeting.more.support.shortcut.empty')}</p>
        )}
        {groups.map((g) => (
          <div key={g.id}>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--c-fg-muted)]">{t(g.titleKey)}</h3>
            <ul className="divide-y divide-[var(--c-line)] rounded-lg border border-[var(--c-line)]">
              {g.items.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-4 px-3 py-2 text-[13px]">
                  <span className="text-[var(--c-fg)]">{t(it.labelKey)}</span>
                  <span className="flex items-center gap-1">
                    {keysFor(it, mac).map((k, i) => (
                      <kbd
                        key={i}
                        className="min-w-[22px] rounded border border-[var(--c-line-strong)] bg-[var(--c-bg-2)] px-1.5 py-0.5 text-center text-[12px] font-medium text-[var(--c-fg)]"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  )
}
