/**
 * Native (Electron) MeetingWindowAdapter.
 *
 * ── SINGLE FUTURE IPC INTEGRATION POINT ──────────────────────────────────────
 * This is the ONLY file that changes when native window IPC is implemented. The
 * Electron preload will expose a validated bridge at `window.zoiko.window.*`
 * (setKeepOnTop / getWindowState / listDisplays / moveToDisplay / subscribe /
 * getCapabilities); this adapter forwards to it. When that bridge exists,
 * `capabilities` reports true and the Window section auto-appears — with NO change
 * to menu rendering, the resolver, localization, or dialog infrastructure.
 *
 * Uses ONLY the contextBridge object (`window.zoiko`) — never `require('electron')`
 * — so no Electron dependency reaches the renderer/browser bundle.
 */
export function createElectronWindowAdapter() {
  const bridge = (typeof window !== 'undefined' && window.zoiko?.window) || null

  // Capabilities reflect what the preload bridge actually exposes. Until native IPC
  // lands, the bridge is absent → no capabilities → Window section stays hidden.
  const capabilities = {
    keepOnTop: !!bridge?.setKeepOnTop,
    moveDisplay: !!bridge?.moveToDisplay,
  }
  const unsupported = async () => ({ ok: false, reason: 'unsupported' })

  return {
    platform: 'electron',
    capabilities,
    getCapabilities: async () => (bridge?.getCapabilities ? bridge.getCapabilities() : capabilities),
    getWindowState: async () => (bridge?.getWindowState ? bridge.getWindowState() : { keepOnTop: false }),
    setKeepOnTop: bridge?.setKeepOnTop ? (next, correlationId) => bridge.setKeepOnTop(next, correlationId) : unsupported,
    listDisplays: bridge?.listDisplays ? (correlationId) => bridge.listDisplays(correlationId) : async () => [],
    moveToDisplay: bridge?.moveToDisplay ? (id, correlationId) => bridge.moveToDisplay(id, correlationId) : unsupported,
    subscribe: bridge?.subscribe ? (listener) => bridge.subscribe(listener) : () => () => {},
  }
}
