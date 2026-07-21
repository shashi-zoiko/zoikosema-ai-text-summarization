import { OWNER, PERSISTENCE, PRESENTATION, SECTION } from './constants.js'

/**
 * Canonical More Menu section registry (ZS-MTG-IMP-03, Appendix A + §5).
 *
 * DECLARATIVE METADATA ONLY — no behavior, no imports of React/icons/services.
 * Item IDs, localization keys, owner, persistence and availability follow the
 * canonical spec exactly. The resolver (resolver.js) turns these into resolved
 * access-states; the render layer maps `icon` names to components and looks up
 * `localeKey`/`<localeKey>.desc` through the shared i18n `t()`.
 *
 * `presentation` is normalized to a single PRESENTATION value (Appendix A lists a
 * few combined forms, e.g. "command/check", "dialog/panel"); the combined intent
 * is realized by the resolver's `checked`/state, not by a second presentation.
 * `availability` is stored verbatim from Appendix A and interpreted by the resolver.
 */

export const MORE_MENU_REGISTRY = Object.freeze([
  // ── View ────────────────────────────────────────────────────────────────
  { id: 'view.adaptive',        section: SECTION.VIEW, presentation: PRESENTATION.RADIO,   owner: OWNER.SHELL,          persistence: PERSISTENCE.ACCOUNT_DEVICE, availability: 'All',                  localeKey: 'meeting.more.view.adaptive',        icon: 'Wand2' },
  { id: 'view.grid',            section: SECTION.VIEW, presentation: PRESENTATION.RADIO,   owner: OWNER.SHELL,          persistence: PERSISTENCE.ACCOUNT_DEVICE, availability: 'All',                  localeKey: 'meeting.more.view.grid',            icon: 'Grid3x3' },
  { id: 'view.speaker',         section: SECTION.VIEW, presentation: PRESENTATION.RADIO,   owner: OWNER.SHELL,          persistence: PERSISTENCE.ACCOUNT_DEVICE, availability: 'All',                  localeKey: 'meeting.more.view.speaker',         icon: 'SquareUser' },
  { id: 'view.presenter',       section: SECTION.VIEW, presentation: PRESENTATION.RADIO,   owner: OWNER.SHELL,          persistence: PERSISTENCE.MEETING,        availability: 'All',                  localeKey: 'meeting.more.view.presenter',       icon: 'MonitorPlay' },
  { id: 'view.meeting_center',  section: SECTION.VIEW, presentation: PRESENTATION.CHECK,   owner: OWNER.SHELL,          persistence: PERSISTENCE.MEETING,        availability: 'All',                  localeKey: 'meeting.more.view.meeting_center',  icon: 'PanelRight' },
  { id: 'view.focus',           section: SECTION.VIEW, presentation: PRESENTATION.CHECK,   owner: OWNER.SHELL,          persistence: PERSISTENCE.DEVICE,         availability: 'All',                  localeKey: 'meeting.more.view.focus',           icon: 'Focus' },
  { id: 'view.full_screen',     section: SECTION.VIEW, presentation: PRESENTATION.COMMAND, owner: OWNER.PLATFORM,       persistence: PERSISTENCE.EPHEMERAL,      availability: 'Web/native',           localeKey: 'meeting.more.view.full_screen',     icon: 'Maximize' },
  { id: 'view.pip',             section: SECTION.VIEW, presentation: PRESENTATION.COMMAND, owner: OWNER.PLATFORM,       persistence: PERSISTENCE.EPHEMERAL,      availability: 'Capability-gated',     localeKey: 'meeting.more.view.pip',             icon: 'PictureInPicture2' },
  { id: 'view.self_view',       section: SECTION.VIEW, presentation: PRESENTATION.CHECK,   owner: OWNER.SHELL,          persistence: PERSISTENCE.ACCOUNT_DEVICE, availability: 'All',                  localeKey: 'meeting.more.view.self_view',       icon: 'CircleUser' },

  // ── Appearance & Media ──────────────────────────────────────────────────
  { id: 'media.backgrounds',        section: SECTION.APPEARANCE_MEDIA, presentation: PRESENTATION.SUBMENU, owner: OWNER.MEDIA,    persistence: PERSISTENCE.ACCOUNT_DEVICE, availability: 'Capability/policy', localeKey: 'meeting.more.media.backgrounds',        icon: 'Image' },
  { id: 'media.framing',            section: SECTION.APPEARANCE_MEDIA, presentation: PRESENTATION.SUBMENU, owner: OWNER.MEDIA,    persistence: PERSISTENCE.ACCOUNT_DEVICE, availability: 'Capability/policy', localeKey: 'meeting.more.media.framing',            icon: 'Frame' },
  { id: 'media.visual_clarity',     section: SECTION.APPEARANCE_MEDIA, presentation: PRESENTATION.SUBMENU, owner: OWNER.MEDIA,    persistence: PERSISTENCE.ACCOUNT_DEVICE, availability: 'Capability/policy', localeKey: 'meeting.more.media.visual_clarity',     icon: 'Sun' },
  { id: 'media.noise_suppression',  section: SECTION.APPEARANCE_MEDIA, presentation: PRESENTATION.SUBMENU, owner: OWNER.AUDIO,    persistence: PERSISTENCE.DEVICE,         availability: 'Capability/policy', localeKey: 'meeting.more.media.noise_suppression',  icon: 'AudioLines' },
  { id: 'media.settings',           section: SECTION.APPEARANCE_MEDIA, presentation: PRESENTATION.ROUTE,   owner: OWNER.SETTINGS, persistence: PERSISTENCE.NONE,           availability: 'All',               localeKey: 'meeting.more.media.settings',           icon: 'Settings2' },
  { id: 'media.speaker_test',       section: SECTION.APPEARANCE_MEDIA, presentation: PRESENTATION.DIALOG,  owner: OWNER.DEVICE,   persistence: PERSISTENCE.EPHEMERAL,      availability: 'Output available',  localeKey: 'meeting.more.media.speaker_test',       icon: 'Volume2' },
  { id: 'media.camera_preview',     section: SECTION.APPEARANCE_MEDIA, presentation: PRESENTATION.DIALOG,  owner: OWNER.MEDIA,    persistence: PERSISTENCE.EPHEMERAL,      availability: 'Camera available',  localeKey: 'meeting.more.media.camera_preview',     icon: 'Camera' },

  // ── Diagnostics ─────────────────────────────────────────────────────────
  { id: 'diag.connection',      section: SECTION.DIAGNOSTICS, presentation: PRESENTATION.DIALOG,  owner: OWNER.DIAGNOSTICS, persistence: PERSISTENCE.NONE,      availability: 'All',            localeKey: 'meeting.more.diagnostics.connection',     icon: 'Activity' },
  { id: 'diag.av_check',        section: SECTION.DIAGNOSTICS, presentation: PRESENTATION.DIALOG,  owner: OWNER.DEVICE,      persistence: PERSISTENCE.EPHEMERAL, availability: 'All',            localeKey: 'meeting.more.diagnostics.av_check',       icon: 'Video' },
  { id: 'diag.copy_reference',  section: SECTION.DIAGNOSTICS, presentation: PRESENTATION.COMMAND, owner: OWNER.DIAGNOSTICS, persistence: PERSISTENCE.NONE,      availability: 'Service/policy', localeKey: 'meeting.more.diagnostics.copy_reference', icon: 'ClipboardCopy' },

  // ── Support & Safety ────────────────────────────────────────────────────
  { id: 'support.shortcuts',      section: SECTION.SUPPORT_SAFETY, presentation: PRESENTATION.DIALOG, owner: OWNER.SHORTCUT_SERVICE, persistence: PERSISTENCE.NONE, availability: 'All',                localeKey: 'meeting.more.support.shortcuts',     icon: 'Keyboard' },
  { id: 'support.help',           section: SECTION.SUPPORT_SAFETY, presentation: PRESENTATION.ROUTE,  owner: OWNER.SUPPORT,          persistence: PERSISTENCE.NONE, availability: 'All',                localeKey: 'meeting.more.support.help',          icon: 'HelpCircle' },
  { id: 'support.problem',        section: SECTION.SUPPORT_SAFETY, presentation: PRESENTATION.ROUTE,  owner: OWNER.SUPPORT,          persistence: PERSISTENCE.NONE, availability: 'All',                localeKey: 'meeting.more.support.problem',       icon: 'AlertTriangle' },
  { id: 'support.abuse',          section: SECTION.SUPPORT_SAFETY, presentation: PRESENTATION.ROUTE,  owner: OWNER.TRUST_SAFETY,     persistence: PERSISTENCE.NONE, availability: 'All permitted users', localeKey: 'meeting.more.support.abuse',         icon: 'ShieldAlert' },
  { id: 'support.accessibility',  section: SECTION.SUPPORT_SAFETY, presentation: PRESENTATION.ROUTE,  owner: OWNER.ACCESSIBILITY,    persistence: PERSISTENCE.NONE, availability: 'All',                localeKey: 'meeting.more.support.accessibility', icon: 'Accessibility' },
  { id: 'support.settings',       section: SECTION.SUPPORT_SAFETY, presentation: PRESENTATION.ROUTE,  owner: OWNER.SETTINGS,         persistence: PERSISTENCE.NONE, availability: 'All',                localeKey: 'meeting.more.support.settings',      icon: 'Settings' },

  // ── Window (native desktop only) ────────────────────────────────────────
  { id: 'window.keep_on_top',   section: SECTION.WINDOW, presentation: PRESENTATION.CHECK,   owner: OWNER.NATIVE_ADAPTER, persistence: PERSISTENCE.DEVICE,  availability: 'Native only',           localeKey: 'meeting.more.window.keep_on_top',   icon: 'Pin' },
  { id: 'window.move_display',  section: SECTION.WINDOW, presentation: PRESENTATION.SUBMENU, owner: OWNER.NATIVE_ADAPTER, persistence: PERSISTENCE.SESSION, availability: 'Native multi-display',   localeKey: 'meeting.more.window.move_display',  icon: 'Monitor' },
])

/**
 * Section IA + layout metadata (§5.1). Left column: View → Appearance & Media →
 * Window (native only). Right column: Diagnostics → Support & Safety. Single-column
 * order flattens to View → Appearance & Media → Diagnostics → Support & Safety →
 * Window. Consumed by the geometry layer in phase 03.3 — declarative only.
 */
export const MORE_MENU_SECTIONS = Object.freeze([
  { id: SECTION.VIEW,             headingKey: 'meeting.more.section.view',             column: 'left',  columnOrder: 1, singleOrder: 1, nativeOnly: false },
  { id: SECTION.APPEARANCE_MEDIA, headingKey: 'meeting.more.section.appearance_media', column: 'left',  columnOrder: 2, singleOrder: 2, nativeOnly: false },
  { id: SECTION.WINDOW,           headingKey: 'meeting.more.section.window',           column: 'left',  columnOrder: 3, singleOrder: 5, nativeOnly: true },
  { id: SECTION.DIAGNOSTICS,      headingKey: 'meeting.more.section.diagnostics',      column: 'right', columnOrder: 1, singleOrder: 3, nativeOnly: false },
  { id: SECTION.SUPPORT_SAFETY,   headingKey: 'meeting.more.section.support_safety',   column: 'right', columnOrder: 2, singleOrder: 4, nativeOnly: false },
])
