/**
 * Web MeetingWindowAdapter — native window controls are unsupported in the
 * browser. Reports no capabilities (so the resolver hides the Window section
 * entirely — never a disabled placeholder) and every action is a safe no-op.
 * Contains no browser window-management emulation.
 */
export function createWebWindowAdapter() {
  const unsupported = async () => ({ ok: false, reason: 'unsupported' })
  return {
    platform: 'web',
    capabilities: { keepOnTop: false, moveDisplay: false },
    getCapabilities: async () => ({ keepOnTop: false, moveDisplay: false }),
    getWindowState: async () => ({ keepOnTop: false }),
    setKeepOnTop: unsupported,
    listDisplays: async () => [],
    moveToDisplay: unsupported,
    subscribe: () => () => {},
  }
}
