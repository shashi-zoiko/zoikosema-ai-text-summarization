import { MORE_MENU_REGISTRY, MORE_MENU_SECTIONS } from './registry.js'
import { CONTROL_STATE, PROVENANCE, SECTION } from './constants.js'

/**
 * PersonalControlResolver (ZS-MTG-IMP-03 §14).
 *
 * The SINGLE source of truth that turns declarative registry entries into
 * ResolvedPersonalControl descriptors — availability, checked/active, managed,
 * unsupported and persistence. The render layer consumes only this output, never
 * the raw registry, so no component invents capability or state.
 *
 * Pure function of its injected `inputs` — it performs no LiveKit/media/IPC calls.
 * Live inputs (meeting state, media/device actual-state, platform capability,
 * policy) are threaded in by callers in later phases; until then it returns the
 * declarative baseline plus the spec's "unavailable/managed-with-reason" states
 * for controls whose implementation is deferred (§14.3).
 *
 * @param {Object} [inputs]
 * @param {{ isElectron?: boolean }} [inputs.platform]
 * @returns {import('./constants.js').ResolvedPersonalControl[]}
 */

// Controls implemented in later packages — rendered visibly with a plain-language
// reason rather than hidden (§14.3). This is the ONLY place these deferrals live.
const DEFERRED = Object.freeze({
  'media.framing':           { state: CONTROL_STATE.UNAVAILABLE, reasonTextKey: 'meeting.more.reason.framing',           provenance: [PROVENANCE.DEVICE] },
  'media.visual_clarity':    { state: CONTROL_STATE.UNAVAILABLE, reasonTextKey: 'meeting.more.reason.visual_clarity',    provenance: [PROVENANCE.DEVICE] },
  'media.noise_suppression': { state: CONTROL_STATE.MANAGED,     reasonTextKey: 'meeting.more.reason.noise_suppression', provenance: [PROVENANCE.DEVICE, PROVENANCE.PLATFORM] },
  'diag.av_check':           { state: CONTROL_STATE.UNAVAILABLE, reasonTextKey: 'meeting.more.reason.av_check',          provenance: [PROVENANCE.MEETING] },
  'diag.copy_reference':     { state: CONTROL_STATE.UNAVAILABLE, reasonTextKey: 'meeting.more.reason.copy_reference',    provenance: [PROVENANCE.POLICY] },
  'support.abuse':           { state: CONTROL_STATE.UNAVAILABLE, reasonTextKey: 'meeting.more.reason.abuse',             provenance: [PROVENANCE.POLICY] },
})

export function resolveControls(inputs = {}) {
  const view = inputs.view
  const win = inputs.window

  return MORE_MENU_REGISTRY.map((item) => {
    // Window section availability comes from the platform adapter's capabilities
    // (inputs.window). Unsupported items resolve unavailable; the render layer
    // hides the whole section when nothing is supported (§14.3) — never a
    // disabled placeholder. The resolver stays platform-agnostic (input only).
    if (item.section === SECTION.WINDOW) {
      return build(item, resolveWindowItem(item.id, win))
    }

    const deferred = DEFERRED[item.id]
    if (deferred) return build(item, deferred)

    // View section: checked/active + availability derive from the live view model
    // (wired in phase 03.4). When no view model is supplied the baseline applies.
    if (item.section === SECTION.VIEW && view) {
      return build(item, resolveViewItem(item.id, view))
    }

    // Baseline available. Live checked/active/managed states for other sections
    // arrive with their adapters in later phases.
    return build(item, { state: CONTROL_STATE.AVAILABLE, provenance: [PROVENANCE.PREFERENCE] })
  })
}

// Window items resolve purely from adapter capability inputs (§13, §14).
function resolveWindowItem(id, win) {
  const platform = [PROVENANCE.PLATFORM]
  switch (id) {
    case 'window.keep_on_top':
      if (!win?.keepOnTopSupported) {
        return { state: CONTROL_STATE.UNAVAILABLE, reasonTextKey: 'meeting.more.reason.window_unsupported', provenance: platform }
      }
      return selected(!!win.keepOnTopActive, platform)
    case 'window.move_display':
      if (!win?.moveDisplaySupported) {
        return { state: CONTROL_STATE.UNAVAILABLE, reasonTextKey: 'meeting.more.reason.window_unsupported', provenance: platform }
      }
      return { state: CONTROL_STATE.AVAILABLE, provenance: platform }
    default:
      return { state: CONTROL_STATE.UNAVAILABLE, reasonTextKey: 'meeting.more.reason.window_unsupported', provenance: platform }
  }
}

// Selected/active state for a checkable control — ACTIVE when checked, else
// AVAILABLE. Keeps the radio group mutually exclusive from a single view model.
function selected(checked, provenance) {
  return {
    state: checked ? CONTROL_STATE.ACTIVE : CONTROL_STATE.AVAILABLE,
    checked,
    provenance,
  }
}

function resolveViewItem(id, view) {
  const pref = [PROVENANCE.PREFERENCE]
  const platform = [PROVENANCE.PLATFORM]
  switch (id) {
    case 'view.adaptive': return selected(view.mode === 'adaptive', pref)
    case 'view.grid': return selected(view.mode === 'grid', pref)
    case 'view.speaker': return selected(view.mode === 'speaker', pref)
    case 'view.presenter':
      // Available only when shared content / a presenter target exists (§7).
      if (!view.hasPresentable) {
        return { state: CONTROL_STATE.UNAVAILABLE, reasonTextKey: 'meeting.more.reason.presenter_none', provenance: [PROVENANCE.MEETING] }
      }
      return selected(view.mode === 'presenter', [PROVENANCE.MEETING, PROVENANCE.PREFERENCE])
    case 'view.meeting_center': return selected(!!view.meetingCenterOpen, [PROVENANCE.MEETING])
    case 'view.focus': return selected(!!view.focus, pref)
    case 'view.self_view': return selected(!!view.selfView, pref)
    case 'view.full_screen': return selected(!!view.fullscreen, platform) // actual platform state
    case 'view.pip':
      if (!view.pipSupported) {
        return { state: CONTROL_STATE.UNAVAILABLE, reasonTextKey: 'meeting.more.reason.pip_unsupported', provenance: platform }
      }
      return selected(!!view.pip, platform) // actual platform state
    default:
      return { state: CONTROL_STATE.AVAILABLE, provenance: pref }
  }
}

/**
 * View selector: resolve every control, then group into ordered sections with
 * their IA/layout metadata so the render layer consumes ONLY resolver output and
 * never touches the registry. Window is marked not-visible on web (§14.3) — the
 * render layer omits non-visible sections.
 *
 * @param {Object} [inputs] Same inputs as resolveControls.
 * @returns {{ sections: Array<{ id:string, headingKey:string, column:'left'|'right',
 *   columnOrder:number, singleOrder:number, visible:boolean,
 *   items: import('./constants.js').ResolvedPersonalControl[] }> }}
 */
export function resolveMenu(inputs = {}) {
  const resolved = resolveControls(inputs)
  const bySection = new Map()
  for (const control of resolved) {
    if (!bySection.has(control.section)) bySection.set(control.section, [])
    bySection.get(control.section).push(control)
  }
  const sections = MORE_MENU_SECTIONS.map((s) => {
    const items = bySection.get(s.id) || []
    // The Window section is hidden entirely when nothing is supported (§14.3) —
    // no disabled placeholders. Other sections keep unavailable items visible with
    // their reason. Availability is decided upstream by the resolver, never here.
    const visible = s.id === SECTION.WINDOW
      ? items.some((i) => i.state !== CONTROL_STATE.UNAVAILABLE && i.state !== CONTROL_STATE.REVOKED)
      : true
    return {
      id: s.id,
      headingKey: s.headingKey,
      column: s.column,
      columnOrder: s.columnOrder,
      singleOrder: s.singleOrder,
      visible,
      items,
    }
  })
  return { sections }
}

function build(item, resolved) {
  return {
    id: item.id,
    section: item.section,
    presentation: item.presentation,
    persistence: item.persistence,
    owner: item.owner,
    localeKey: item.localeKey,
    icon: item.icon,
    state: resolved.state,
    checked: resolved.checked,
    reasonTextKey: resolved.reasonTextKey,
    provenance: resolved.provenance || [],
    revision: 0,
  }
}
