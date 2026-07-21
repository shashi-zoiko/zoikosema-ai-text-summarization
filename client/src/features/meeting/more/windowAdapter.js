import { createWebWindowAdapter } from './webWindowAdapter.js'
import { createElectronWindowAdapter } from './electronWindowAdapter.js'

/**
 * MeetingWindowAdapter (ZS-MTG-IMP-03 §13.1) — the single abstraction the menu
 * talks to for native window controls. Interface + selection only; NO IPC and NO
 * platform APIs live in menu/resolver/dialog code.
 *
 * @typedef {Object} PlatformResult
 * @property {boolean} ok
 * @property {string} [reason]
 *
 * @typedef {Object} DisplaySummary
 * @property {string} id            Stable display id.
 * @property {string} label         Geometry-safe human name.
 * @property {boolean} [primary]
 * @property {boolean} [current]
 *
 * @typedef {Object} MeetingWindowAdapter
 * @property {'web'|'electron'} platform
 * @property {{ keepOnTop: boolean, moveDisplay: boolean }} capabilities  Sync snapshot for rendering.
 * @property {() => Promise<{ keepOnTop: boolean, moveDisplay: boolean }>} getCapabilities
 * @property {() => Promise<{ keepOnTop: boolean, displayId?: string }>} getWindowState
 * @property {(next: boolean, correlationId: string) => Promise<PlatformResult>} setKeepOnTop
 * @property {(correlationId: string) => Promise<DisplaySummary[]>} listDisplays
 * @property {(displayId: string, correlationId: string) => Promise<PlatformResult>} moveToDisplay
 * @property {(listener: (e: any) => void) => () => void} subscribe
 */

// THE single location that detects the platform and selects the adapter
// implementation. Nothing else inspects `window.zoiko`/Electron to decide behavior.
let _adapter = null

export function getMeetingWindowAdapter() {
  if (_adapter) return _adapter
  const isElectron = typeof window !== 'undefined' && !!window.zoiko?.isElectron
  _adapter = isElectron ? createElectronWindowAdapter() : createWebWindowAdapter()
  return _adapter
}
