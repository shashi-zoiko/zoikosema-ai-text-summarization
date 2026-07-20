/**
 * Support & Safety action adapter / SupportRouteAdapter (ZS-MTG-IMP-03 §12).
 *
 * Reuses existing surfaces only — no duplicate routes/dialogs/settings/help:
 *   - Keyboard shortcuts → in-meeting dialog (canonical registry).
 *   - Help / Report a problem → existing /help-support route, opened in a new tab
 *     so the meeting is preserved (§12.1: external nav must not close the meeting).
 *   - Accessibility → existing in-meeting SettingsDrawer accessibility tab.
 *   - General settings → existing /settings route, new tab (meeting preserved).
 *   - Report abuse → resolver unavailable-with-reason (no moderation backend); the
 *     item is never activatable, so it is never routed here.
 *
 * Allowlisted, fixed internal routes only — no arbitrary/interpolated URLs, no
 * meeting/tenant identifiers in the destination (§12.1).
 */
function openRoute(path) {
  try {
    window.open(path, '_blank', 'noopener,noreferrer')
  } catch {
    // popup blocked / unavailable — fail closed, meeting untouched
  }
}

export function makeSupportActionHandler({ view, onOpenDialog, close }) {
  return (control) => {
    switch (control.id) {
      case 'support.shortcuts': onOpenDialog?.('shortcuts'); close?.(); break
      case 'support.help': openRoute('/help-support'); close?.(); break
      case 'support.problem': openRoute('/help-support'); close?.(); break
      case 'support.accessibility': view?.openSettings?.('accessibility'); close?.(); break
      case 'support.settings': openRoute('/settings'); close?.(); break
      default: break // support.abuse (unavailable) + other sections: no-op
    }
  }
}
