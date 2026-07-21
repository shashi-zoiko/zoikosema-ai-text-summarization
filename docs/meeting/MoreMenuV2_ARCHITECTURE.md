# More Menu v2 — Architecture Decision Record & Ownership Map

**Status:** Shipped — `meeting.more_v2` **default ON** (enabled for production 2026-07-20); legacy `MoreMenu` retained as a kill switch · **Date:** 2026-07-20
**Spec:** ZS-MTG-IMP-03 (More Menu & Personal Media Controls) · **Location:** `client/src/features/meeting/more/`

## Context
ZS-MTG-IMP-03 depends on upstream packages (IMP-00/01/02) that assumed a shared
OverlayHost, access-state resolver, preference store, feature-flag, telemetry, and
localization platform — **none of which existed in this codebase**. The feature was
built reuse-first: extend existing meeting infrastructure, introduce the *first*
(not duplicate) instance of each missing primitive, and defer anything needing a
backend to a documented unavailable-with-reason state.

## Decisions

### D1 — The resolver owns all access-state resolution
`resolver.js` is the single authority for availability, checked/active, managed,
unavailable, and reason text. Render components consume only `ResolvedPersonalControl[]`
(never the registry) so no component re-derives capability. **Why:** §14 mandates a
single resolver; it keeps state honest and revalidatable, and prevents drift between
what the UI shows and what is actually permitted.

### D2 — `MeetingWindowAdapter` abstracts native window controls
All platform behavior lives behind the adapter (`windowAdapter.js` selection +
`web`/`electron` implementations). Window availability is **capability-driven**, not
`isElectron`-driven. **Why:** §13.1 requires signed platform adapters; it keeps the
renderer Electron-free and gives native IPC exactly one future integration point
(`electronWindowAdapter.js` + preload) with zero UI/resolver changes.

### D3 — `OverlayHost` is the single overlay coordinator
One portal, one z-index stack, one dismissal/focus-return owner (`OverlayHost.jsx`).
**Why:** §6.1 forbids feature packages minting independent portals. No such
coordinator existed; this is the first, not a duplicate. (Dialogs use the shared
`Modal`; OverlayHost coordinates the menu/popover only.)

### D4 — `useDisposable` standardizes dialog lifecycle
Every subflow dialog acquires/releases resources through one contract
(`useDisposable.js`). **Why:** deterministic, uniform disposal (no per-dialog cleanup
drift); satisfies §9.1/§15.2 and the resource budgets in §21.

### D5 — Deferred functionality stays unavailable-with-reason (not stubbed)
Framing, Sema Visual Clarity, Noise Suppression, AV Check, Copy Diagnostic Reference,
Report Abuse, and native Window IPC render via the resolver's unavailable/managed
states. **Why:** §14.3 keeps teaching items visible with a recovery reason; stubbing
fake behavior would violate honesty and the media-safety contract. See the Roadmap doc.

### D6 — Feature-flag gated, shipped ON, legacy retained as kill switch
`meeting.more_v2` gates the entire feature. It was **flipped to default ON for
production on 2026-07-20** (product decision to ship directly rather than run the
staged cohort rollout §26 describes). Legacy `MoreMenu` remains in the tree and is
reachable as a kill switch via `localStorage` `zoiko_ff_meeting_more_v2='0'` or a
build with `VITE_MEETING_MORE_V2=0`. **Why keep the flag/legacy:** instant rollback
without a redeploy if live QA (owned by the QA team, running post-release) surfaces
an issue. Do not delete legacy until QA sign-off.

## Component ownership (single responsibility each)
| Component | Owns | Must NOT own |
|---|---|---|
| `resolver.js` | availability / checked / managed / reason resolution | rendering, platform IPC |
| `registry.js` | declarative canonical item + section metadata | behavior, logic |
| `OverlayHost.jsx` | overlay portal, stack, dismissal, focus return | meeting/media state |
| `useDisposable.js` | dialog acquire → dispose contract | feature-specific logic |
| `MeetingWindowAdapter` (`windowAdapter.js` + impls) | platform detection, adapter selection, native window ops | UI, resolver logic |
| `ViewControlsContext` | conduit exposing MeetRoom's existing view state | owning/duplicating that state |
| `SupportRouteAdapter` (`supportActions.js`) | allowlisted routing to existing surfaces | support/business logic |
| `WindowActionHandler` (`windowActions.js`) | routing window intents to the adapter | availability/state decisions |
| `MoreMenuRoot.jsx` | trigger, overlay open/close, dialog hosting, **centralized focus restoration** | availability, platform inspection |
| `statsCollector.js` | single bounded polling lifecycle | LiveKit/React specifics |
| Localization | `lib/i18n` under `meeting.more.*` (extended via `registerMessages`) | a second i18n system |

## Deterministic verification (CI-able without a browser)
The resolver, registry, localization, window adapter, and collector lifecycle are
pure/deterministic and were verified via standalone Node scripts during development
(registry↔Appendix A, localization/namespace/dupes, view mutual-exclusivity +
presenter gating, window capability visibility, collector single-interval + 25×
open/close stress). These should be promoted to committed unit tests once a client
test runner exists (see Roadmap → tooling).

## Invariants to preserve
- Resolver is the only availability authority; components read resolved output only.
- Platform detection/adapter selection happen in exactly one place (`getMeetingWindowAdapter`).
- Renderer imports no Electron; native code only behind the adapter.
- Dialogs use `useDisposable`; focus restoration lives only in `MoreMenuRoot`.
- Everything stays behind `meeting.more_v2` (now default ON); legacy `MoreMenu` remains as the kill switch until QA sign-off.
- Opening/scrolling/using the menu never remounts tracks or renegotiates LiveKit (§18).
