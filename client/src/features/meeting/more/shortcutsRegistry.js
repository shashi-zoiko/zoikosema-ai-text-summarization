/**
 * Canonical meeting keyboard-shortcut registry (ZS-MTG-IMP-03 §12).
 *
 * The single declarative source the Keyboard Shortcuts dialog renders from, so the
 * displayed list can't silently drift into a second hardcoded copy. These mirror
 * the bindings the app actually implements today:
 *   - Mic toggle  — Ctrl/⌘ + D   (MeetRoomLivekit RoomEffects)
 *   - Camera toggle — Ctrl/⌘ + E (MeetRoomLivekit RoomEffects)
 *   - Captions toggle — C        (captions/CaptionProvider)
 *
 * Only bindings that genuinely exist are listed — nothing is fabricated. Keys are
 * platform-shaped (⌘ on macOS, Ctrl elsewhere); labels resolve through the shared
 * i18n `meeting.more.*` namespace.
 *
 * NOTE: the live keydown handlers still hard-code these same bindings; wiring them
 * to consume this registry is a separate keyboard-subsystem consolidation. Until
 * then this registry mirrors them exactly (documented drift risk).
 */

export function isMacPlatform() {
  if (typeof navigator === 'undefined') return false
  const p = navigator.userAgentData?.platform || navigator.platform || ''
  return /mac/i.test(p)
}

export const SHORTCUT_GROUPS = Object.freeze([
  {
    id: 'media',
    titleKey: 'meeting.more.support.shortcut.group.media',
    items: [
      { id: 'mic', labelKey: 'meeting.more.support.shortcut.mic', keys: { mac: ['⌘', 'D'], other: ['Ctrl', 'D'] } },
      { id: 'camera', labelKey: 'meeting.more.support.shortcut.camera', keys: { mac: ['⌘', 'E'], other: ['Ctrl', 'E'] } },
      { id: 'captions', labelKey: 'meeting.more.support.shortcut.captions', keys: { mac: ['C'], other: ['C'] } },
    ],
  },
])

export function keysFor(item, mac) {
  return (mac ? item.keys.mac : item.keys.other) || item.keys.other
}
