import { createElement, forwardRef } from 'react'
import { Check, ChevronRight, ExternalLink, Lock } from 'lucide-react'
import { t } from '../../../lib/i18n.js'
import { getMoreMenuIcon } from './icons.js'
import { CONTROL_STATE, PRESENTATION } from './constants.js'

/**
 * One More-menu item. Presentation, roles and states come entirely from the
 * ResolvedPersonalControl (§14.2) — this component never inspects the registry or
 * derives availability. Rendering is independent of action execution: `onActivate`
 * is optional and unused in phase 03.3.
 *
 * A11y (§20): radio → menuitemradio, check → menuitemcheckbox (aria-checked),
 * everything else → menuitem. Unavailable/managed items stay focusable with
 * aria-disabled and a plain-language reason, so keyboard/AT users learn why.
 * State is never color-only — a check glyph and aria-checked back it up.
 */

function roleFor(presentation) {
  if (presentation === PRESENTATION.RADIO) return 'menuitemradio'
  if (presentation === PRESENTATION.CHECK) return 'menuitemcheckbox'
  return 'menuitem'
}

const PersonalControlItem = forwardRef(function PersonalControlItem(
  { control, tabIndex, onFocus, onActivate },
  ref,
) {
  const label = t(control.localeKey)
  const subtext = control.reasonTextKey ? t(control.reasonTextKey) : t(`${control.localeKey}.desc`)
  const role = roleFor(control.presentation)
  const checkable = role !== 'menuitem'
  const checked = checkable ? !!control.checked : undefined

  const unavailable = control.state === CONTROL_STATE.UNAVAILABLE || control.state === CONTROL_STATE.REVOKED
  const managed = control.state === CONTROL_STATE.MANAGED
  const active = control.state === CONTROL_STATE.ACTIVE || checked
  const descId = `more-item-${control.id}-desc`

  return (
    <button
      ref={ref}
      type="button"
      role={role}
      tabIndex={tabIndex}
      aria-checked={checkable ? checked : undefined}
      aria-disabled={unavailable || undefined}
      aria-describedby={descId}
      onFocus={onFocus}
      onClick={() => { if (!unavailable) onActivate?.(control) }}
      className={
        'group flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]/50 ' +
        (unavailable
          ? 'cursor-default opacity-55'
          : 'hover:bg-white/[0.06] focus-visible:bg-white/[0.06]')
      }
    >
      <span
        className={
          'grid h-6 w-6 shrink-0 place-items-center [&_svg]:h-[18px] [&_svg]:w-[18px] ' +
          (active ? 'text-[#34D399]' : 'text-white/70')
        }
      >
        {createElement(getMoreMenuIcon(control.icon), { 'aria-hidden': true })}
      </span>
      <span className="min-w-0 flex-1">
        <span className={'block truncate text-[14px] ' + (active ? 'text-[#34D399]' : 'text-white/90')}>
          {label}
        </span>
        <span id={descId} className="block text-[12px] leading-snug text-white/45">
          {subtext}
        </span>
      </span>
      <span className="grid h-5 w-5 shrink-0 place-items-center text-white/50 [&_svg]:h-4 [&_svg]:w-4">
        {managed && <Lock aria-hidden />}
        {!managed && checkable && checked && <Check aria-hidden className="text-[#34D399]" />}
        {!managed && control.presentation === PRESENTATION.SUBMENU && <ChevronRight aria-hidden />}
        {!managed && control.presentation === PRESENTATION.ROUTE && <ExternalLink aria-hidden />}
      </span>
    </button>
  )
})

export default PersonalControlItem
