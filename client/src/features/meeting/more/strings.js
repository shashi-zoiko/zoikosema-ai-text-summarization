import { registerMessages } from '../../../lib/i18n.js'

/**
 * More Menu v2 localization fixture (ZS-MTG-IMP-03 §5.2, §6).
 *
 * A DATA fixture for the shared i18n system — not a second localization system.
 * Canonical `meeting.more.*` label keys match the spec exactly; item subtext is
 * keyed as `<localeKey>.desc`. Section headings and access-state reasons live
 * under `meeting.more.section.*` / `meeting.more.reason.*`.
 *
 * English is the base; the shared `t()` already falls back to `en` for any locale
 * missing a key, so additional locales can be registered later (phase 03.10)
 * without touching consumers.
 */

export const MORE_MENU_MESSAGES_EN = {
  // Section headings (canonical figure vocabulary; "Meeting Center" not "Sidebar").
  'meeting.more.section.view': 'View',
  'meeting.more.section.appearance_media': 'Appearance & Media',
  'meeting.more.section.diagnostics': 'Diagnostics',
  'meeting.more.section.support_safety': 'Support & Safety',
  'meeting.more.section.window': 'Window',

  // View
  'meeting.more.view.adaptive': 'Adaptive',
  'meeting.more.view.adaptive.desc': 'Automatically choose the best layout.',
  'meeting.more.view.grid': 'Grid',
  'meeting.more.view.grid.desc': 'Show visible participants in a grid.',
  'meeting.more.view.speaker': 'Speaker',
  'meeting.more.view.speaker.desc': 'Emphasize the active or selected speaker.',
  'meeting.more.view.presenter': 'Presenter',
  'meeting.more.view.presenter.desc': 'Focus on shared content or the presenting participant.',
  'meeting.more.view.meeting_center': 'Meeting Center',
  'meeting.more.view.meeting_center.desc': 'Show or hide the Meeting Center.',
  'meeting.more.view.focus': 'Focus',
  'meeting.more.view.focus.desc': 'Reduce visual distractions while preserving essential controls.',
  'meeting.more.view.full_screen': 'Full screen',
  'meeting.more.view.full_screen.desc': 'Enter full-screen meeting view.',
  'meeting.more.view.pip': 'Picture-in-picture',
  'meeting.more.view.pip.desc': 'Keep the meeting visible in a compact floating view.',
  'meeting.more.view.self_view': 'Show self-view',
  'meeting.more.view.self_view.desc': 'Show your video tile.',

  // Appearance & Media
  'meeting.more.media.backgrounds': 'Backgrounds & effects',
  'meeting.more.media.backgrounds.desc': 'Choose blur, image, or approved effects.',
  'meeting.more.media.framing': 'Framing',
  'meeting.more.media.framing.desc': 'Automatically frame and position you.',
  'meeting.more.media.visual_clarity': 'Sema Visual Clarity',
  'meeting.more.media.visual_clarity.desc': 'Improve visibility using local enhancement.',
  'meeting.more.media.noise_suppression': 'Noise suppression',
  'meeting.more.media.noise_suppression.desc': 'Reduce background noise.',
  'meeting.more.media.settings': 'Audio & video settings',
  'meeting.more.media.settings.desc': 'Choose devices and media preferences.',
  'meeting.more.media.speaker_test': 'Speaker test',
  'meeting.more.media.speaker_test.desc': 'Test your selected audio output.',
  'meeting.more.media.camera_preview': 'Camera preview',
  'meeting.more.media.camera_preview.desc': 'Preview camera and effects locally.',

  // Diagnostics
  'meeting.more.diagnostics.connection': 'Connection statistics',
  'meeting.more.diagnostics.connection.desc': 'View network and media quality.',
  'meeting.more.diagnostics.av_check': 'Audio and video check',
  'meeting.more.diagnostics.av_check.desc': 'Run preflight checks without leaving the meeting.',
  'meeting.more.diagnostics.copy_reference': 'Copy diagnostic reference',
  'meeting.more.diagnostics.copy_reference.desc': 'Copy an opaque support reference.',

  // Support & Safety
  'meeting.more.support.shortcuts': 'Keyboard shortcuts',
  'meeting.more.support.shortcuts.desc': 'View available shortcuts.',
  'meeting.more.support.help': 'Help Center',
  'meeting.more.support.help.desc': 'Open trusted help and tutorials.',
  'meeting.more.support.problem': 'Report a problem',
  'meeting.more.support.problem.desc': 'Send product feedback or a support report.',
  'meeting.more.support.abuse': 'Report abuse',
  'meeting.more.support.abuse.desc': 'Report meeting abuse through a protected workflow.',
  'meeting.more.support.accessibility': 'Accessibility',
  'meeting.more.support.accessibility.desc': 'Open accessibility options.',
  'meeting.more.support.settings': 'General settings',
  'meeting.more.support.settings.desc': 'Open application and meeting settings.',

  // Window (native desktop only)
  'meeting.more.window.keep_on_top': 'Keep on top',
  'meeting.more.window.keep_on_top.desc': 'Keep this meeting window above others.',
  'meeting.more.window.move_display': 'Move to another display',
  'meeting.more.window.move_display.desc': 'Move the meeting to a selected display.',

  // Accessible name for the menu container (§20 menu semantics).
  'meeting.more.a11y.menu_label': 'More options',

  // Keyboard shortcuts dialog.
  'meeting.more.support.shortcut.title': 'Keyboard shortcuts',
  'meeting.more.support.shortcut.search': 'Search shortcuts',
  'meeting.more.support.shortcut.empty': 'No matching shortcuts.',
  'meeting.more.support.shortcut.group.media': 'Audio & video',
  'meeting.more.support.shortcut.mic': 'Toggle microphone',
  'meeting.more.support.shortcut.camera': 'Toggle camera',
  'meeting.more.support.shortcut.captions': 'Toggle captions',

  // Access-state reasons (§14.3 — shown when an item is not plainly available).
  'meeting.more.reason.framing': 'Automatic framing isn’t available on this device yet.',
  'meeting.more.reason.visual_clarity': 'Sema Visual Clarity isn’t available on this device yet.',
  'meeting.more.reason.noise_suppression': 'Managed by your browser’s built-in audio processing.',
  'meeting.more.reason.av_check': 'The audio and video check isn’t available yet.',
  'meeting.more.reason.copy_reference': 'Diagnostic references aren’t available yet.',
  'meeting.more.reason.abuse': 'Abuse reporting isn’t available in this build yet.',
  'meeting.more.reason.window_web': 'Window controls are available in the Zoiko desktop app.',
  'meeting.more.reason.window_unsupported': 'Not available on this device.',
  'meeting.more.reason.presenter_none': 'Available when someone is sharing content.',
  'meeting.more.reason.pip_unsupported': 'Picture-in-picture isn’t supported in this browser.',
}

let _registered = false

/** Register the fixture into the shared i18n system. Idempotent; call once at
 *  the More Menu's first render (phase 03.3 wires this in). */
export function registerMoreMenuStrings() {
  if (_registered) return
  registerMessages('en', MORE_MENU_MESSAGES_EN)
  _registered = true
}
