/**
 * Window control action adapter. Routes Window item activation to the
 * MeetingWindowAdapter — executes only, never decides availability/state.
 *
 * Dormant until the adapter reports capabilities (the section is hidden while
 * unsupported, so these never fire today). Wiring them now is the forward-compat
 * action integration point: when native IPC lands, actions work with zero UI change.
 */
export function makeWindowActionHandler({ adapter, close }) {
  return (control) => {
    switch (control.id) {
      case 'window.keep_on_top':
        // Toggle against the resolved actual state (§7.1 platform actual state).
        adapter?.setKeepOnTop?.(!control.checked, `more-${control.id}`)
        break
      case 'window.move_display':
        // Display picker lands with native IPC (listDisplays → picker → moveToDisplay).
        close?.()
        break
      default:
        break
    }
  }
}
