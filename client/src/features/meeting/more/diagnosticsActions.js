/**
 * Diagnostics action adapter (ZS-MTG-IMP-03 §10). Opens the bounded Connection
 * Statistics dialog. AV check and Copy diagnostic reference stay resolver
 * unavailable-with-reason (no backend yet) and are never activated here.
 */
export function makeDiagnosticsActionHandler({ onOpenDialog, close }) {
  return (control) => {
    switch (control.id) {
      case 'diag.connection': onOpenDialog?.('connection'); close?.(); break
      default: break // diag.av_check / diag.copy_reference: unavailable, no-op
    }
  }
}
