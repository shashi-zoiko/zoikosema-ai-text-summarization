# More Menu v2 — Runtime QA Checklist (ZS-MTG-IMP-03)

**v2 shipped ON by default (2026-07-20).** This is the QA team's **post-release**
validation checklist — the items that can't be proven by build/lint/unit checks
(real browser, live media, assistive tech). If any check fails, use the kill switch
(below) to fall back to the legacy menu without a redeploy, and file the issue.
Static/deterministic verification (registry, resolver states, localization,
collector lifecycle) is already covered in CI-able form — see the ADR.

## Flag state (default ON)
The `⋮` **More** button opens the v2 menu by default. To compare against legacy /
use the kill switch during testing:
```js
localStorage.setItem('zoiko_ff_meeting_more_v2', '0')   // force legacy, then reload
localStorage.removeItem('zoiko_ff_meeting_more_v2')     // back to default (v2 ON), then reload
```
Build-level kill switch: `VITE_MEETING_MORE_V2=0` forces legacy for an entire build.

## 1. Persistence matrix
Keys: `zoiko_meet_view_mode` (adaptive|grid|speaker), `zoiko_meet_self_view` (1|0).
Presenter is meeting-scoped and never persisted.

| Case | Setup | Expected |
|---|---|---|
| Fresh launch | clear both keys, reload | view = Grid, Self-view ON |
| Restore | set `view_mode=speaker`, reload | Speaker selected |
| Corrupted value | set `view_mode=garbage`, reload | falls back to Grid |
| Unsupported value | set `view_mode=presenter`, reload | falls back to Grid (not persisted) |
| Self-view restore | toggle Self-view off, reload | Self-view OFF |
| Private/Incognito | open in Incognito | no errors; defaults apply |
| Multiple tabs | change mode in tab A | tab B unaffected until its next open |
| Reconnect | drop network mid-meeting, recover | prefs intact |
| Page refresh | reload during meeting | prefs restored |
| Sign-out / sign-in | log out, back in | device-scoped prefs persist (localStorage) |

## 2. Accessibility matrix (keyboard-only + NVDA/VoiceOver)
Per dialog: Speaker Test, Camera Preview, Connection Statistics, Keyboard Shortcuts, and the menu itself.

| Check | Expected |
|---|---|
| Tab / Shift+Tab | reaches all controls, no dead ends |
| Arrow keys (menu) | ↑↓ within column, ←→ switch columns |
| Home / End | first / last item |
| Enter / Space | activates focused item |
| Escape | closes deepest surface; focus returns to More button |
| Screen reader | menu/menuitemradio/menuitemcheckbox + checked state announced; dialog title/labels read |
| Focus order | logical; opening a dialog moves focus into it |
| Focus restoration | closing a dialog returns focus to the More button |

Known limitation (documented, do NOT fix here): the shared `Modal` provides
`aria-modal` + Escape but no JS Tab focus-trap. Modifying the app-wide `Modal` is
separately scoped.

## 3. Live meeting matrix (≥2 participants)
Watch `chrome://webrtc-internals` — `inbound-rtp`/`outbound-rtp` must stay
continuous (no restarts) throughout.

- Join / leave / reconnect
- Presenter switch, screen share start/stop
- Captions on/off
- Pin / unpin
- Meeting Center show/hide, Focus mode, Fullscreen, PiP
- Open every dialog **during live media**

Pass = **no audio/video interruption**, no PeerConnection rebuild.

## 4. Resource verification (DevTools Memory + Performance)
Open each dialog ≥25×, force GC between runs:

- Heap returns to baseline
- Event-listener count flat
- Timer/interval count flat
- **PeerConnection count unchanged**
- No leaked AudioContext (Speaker Test)
- No leaked MediaStream (Camera Preview)

## 5. Performance verification
- Menu open latency (target: cached ≤100 ms p95, cold ≤200 ms — §21)
- Diagnostics dialog open latency
- Repeated open/close render counts (React Profiler): no growth
- Lazy loading effective; adapter singleton reused; resolver pure

## 6. Feature-flag verification
- OFF → legacy More menu, byte-for-byte behavior; no v2 code paths active
- ON → v2 menu; toggling the key + reload switches cleanly with no media disruption
- Rollback (flag OFF mid-session after reload) never leaves/recreates the media session
