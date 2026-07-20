/**
 * ViewControlAdapter (ZS-MTG-IMP-03 §15.1): routes View item activation to the
 * shell's existing selectors/actions. Executes only — it never decides
 * availability or checked state (that's the resolver's job).
 *
 * Simple toggles/radios keep the menu open (rapid switching); platform actions
 * (full screen, PiP) close it once the request is issued (§6.3).
 */
export function makeViewActionHandler({ view, platform, close }) {
  return (control) => {
    switch (control.id) {
      case 'view.adaptive': view?.requestMode?.('adaptive'); break
      case 'view.grid': view?.requestMode?.('grid'); break
      case 'view.speaker': view?.requestMode?.('speaker'); break
      case 'view.presenter': view?.requestMode?.('presenter'); break
      case 'view.meeting_center': view?.toggleMeetingCenter?.(); break
      case 'view.focus': view?.toggleFocus?.(); break
      case 'view.self_view': view?.toggleSelfView?.(); break
      case 'view.full_screen': platform?.toggleFullscreen?.(); close?.(); break
      case 'view.pip': platform?.togglePip?.(); close?.(); break
      default: break // non-View sections wire up in later phases
    }
  }
}
