# More Menu v2 — Deferred Roadmap, Flag Retirement & Rollout

Companion to the ADR and Runtime QA docs. Captures what is intentionally *not* built
yet, so future contributors don't re-audit the whole feature.

## Deferred features
Each renders today via the resolver's unavailable/managed state with a reason string
(`meeting.more.reason.*`). To ship, implement the prerequisite and wire the listed
integration point — **no menu/resolver/localization/dialog architecture changes required.**

| Feature | Resolver state | Dependency / prerequisite | Owning subsystem | Integration point |
|---|---|---|---|---|
| Report Abuse | unavailable | Trust & Safety report-intake backend (consent/retention, §12.2/§23 `ReportStartContext`) | Trust & Safety + Backend | `supportActions.js` |
| AV Check | unavailable | media-controller preflight coordination (bounded, non-destructive) | Media/Device Client | `diagnosticsActions.js` + a preflight collector (reuse `statsCollector` pattern) |
| Copy Diagnostic Reference | unavailable | Diagnostic Reference Service (opaque, expiring; §10.3/§23) | SRE/Support + Backend | `diagnosticsActions.js` |
| Native Window Controls (Keep-on-top, Move-display) | hidden (capability false) | Electron preload bridge `window.zoiko.window.*` + main-process handlers (§13.1 IPC, schema-validated) | Native Desktop | `electronWindowAdapter.js` (+ preload/main) |
| Framing | unavailable | auto-framing pipeline in the camera path | Media Client | `mediaActions.js` + `PersonalMediaCoordinator` |
| Sema Visual Clarity | unavailable | local low-light enhancement (Off/Auto/Enhanced), device/thermal-aware | Media Client | `mediaActions.js` + `PersonalMediaCoordinator` |
| Noise Suppression | managed | in-call Auto/Low/High/Off via AudioController (currently browser-default only) | Audio Client | `mediaActions.js` + AudioController |

## Current status & flag
**`meeting.more_v2` is default ON (shipped to production 2026-07-20).** The staged
cohort rollout below was **not** used — product chose to ship directly. Legacy
`MoreMenu` remains as a kill switch (`localStorage` `zoiko_ff_meeting_more_v2='0'`
or build `VITE_MEETING_MORE_V2=0`).

## Legacy-removal criteria (kill switch stays until all of)
Keep the flag + legacy `MoreMenu` in the tree until:

- [ ] Runtime QA completed (see `MoreMenuV2_Runtime_QA.md`) — owned by QA team, post-release
- [ ] Accessibility QA (keyboard + NVDA/VoiceOver) completed
- [ ] Multi-participant live validation completed (no media interruption)
- [ ] Resource validation completed (heap/listeners/timers/PC stable)
- [ ] Performance validation completed (open latency, no extra renders)
- [ ] No Sev-1/Sev-2 issues over a stable period
- [ ] QA + product sign-off

Only after all of the above should legacy `MoreMenu` be deleted from `MeetingDock.jsx`.
If QA finds a blocker before then, flip the kill switch to fall back to legacy
without a redeploy.

## Tooling follow-ups (separately scoped)
- **No client test runner exists** (Vite only). Add `vitest` to promote the existing
  deterministic Node verifications (resolver, registry, window adapter, view/support
  actions, diagnostics formatting, persistence validation) into committed unit tests,
  then integration/a11y smoke tests. Deferred pending a decision to add the framework.
- **Remote cohort control:** today the kill switch is the `zoiko_ff_meeting_more_v2`
  localStorage override + `VITE_MEETING_MORE_V2` build env. For server-driven cohort
  targeting, wire `isMoreMenuV2Enabled()` (`flags.js`) to a remote-config value —
  single, isolated change.
- **Telemetry:** none exists app-wide; do **not** add a pipeline for this feature.
  When a shared telemetry system lands, emit only high-level events (menu opened,
  dialog opened, unsupported feature selected, unavailable state shown).
- **Shared `Modal` focus-trap:** add a JS Tab-trap to the app-wide `Modal` as a
  separate, cross-cutting change (not scoped to this feature).
