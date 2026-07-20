/**
 * Appearance & Media action adapter (ZS-MTG-IMP-03 §8). Routes item activation to
 * EXISTING surfaces — executes only, never decides state.
 *
 *  - Backgrounds & Audio/Video settings → open the shared SettingsDrawer at a tab
 *    (no second settings dialog / device manager).
 *  - Speaker test / Camera preview → open a bounded dialog (hosted inside the
 *    LiveKit context by MoreMenuRoot, so they reuse the existing media session).
 *
 * Framing / Sema Visual Clarity / Noise suppression are resolved unavailable/
 * managed and are not activated here (no placeholder behavior).
 */
export function makeMediaActionHandler({ view, onOpenDialog, close }) {
  return (control) => {
    switch (control.id) {
      case 'media.backgrounds': view?.openSettings?.('backgrounds'); close?.(); break
      case 'media.settings': view?.openSettings?.('audio'); close?.(); break
      case 'media.speaker_test': onOpenDialog?.('speaker_test'); close?.(); break
      case 'media.camera_preview': onOpenDialog?.('camera_preview'); close?.(); break
      default: break // deferred/managed media items + other sections: no-op
    }
  }
}
