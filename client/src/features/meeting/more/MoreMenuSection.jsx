import { t } from '../../../lib/i18n.js'

/**
 * A menu section: an accessible group (role="group" + aria-labelledby) with its
 * heading and items. Layout metadata comes from the resolver's section output —
 * this component holds no ordering or availability logic (§15.1 MoreMenuSection).
 */
export default function MoreMenuSection({ section, children }) {
  const headingId = `more-section-${section.id}`
  return (
    <div role="group" aria-labelledby={headingId} className="px-1.5 py-1">
      <p
        id={headingId}
        className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-white/40"
      >
        {t(section.headingKey)}
      </p>
      <div>{children}</div>
    </div>
  )
}
