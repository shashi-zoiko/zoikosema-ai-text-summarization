# LiveKit migration — dogfood checklist

Open `http://localhost:5173/` in **two browsers** (or a normal window + an incognito window) as two distinct users.

Prerequisites: `docker compose up -d` running (5 services), `cd client && npm run dev` running. `.env` has `MEDIA_PROVIDER=livekit`.

## 1. Lobby + admission

- [ ] User A creates a meeting from `/meet`
- [ ] User A copies the code (eg `abc-defg-hij`)
- [ ] User B opens `/meet/<code>` — lobby preview shows cam + mic
- [ ] User B clicks Join. Routes to **`/meet/<code>/room-lk`** automatically (per-meeting `media_provider=livekit`)
- [ ] Top-right of room shows two green dots ("Connected" + "Chat")

## 2. Multi-party media

- [ ] Both users see each other's video tile in the grid
- [ ] Audio works both ways (no echo when mic+speaker on same device)
- [ ] User A toggles mic off → User B sees the muted icon on A's tile
- [ ] User A toggles camera off → User B sees the avatar fallback
- [ ] User A clicks screen share → User B sees the screen in a hero slot above the cam grid
- [ ] User A stops sharing → layout returns to grid

## 3. Pinning + spotlight

- [ ] Double-click User B's tile → tile gets the hero slot
- [ ] User A's tile bumps to the strip; small "Pin" icon shows in top-right of pinned tile
- [ ] Click PinOff icon → returns to auto layout
- [ ] When pinned, the pinned participant's video should be visibly sharper than the others (per-track `videoQuality` HIGH vs LOW)

## 4. Chat + reactions + raise-hand

- [ ] Click chat icon → sidebar opens, unread badge clears
- [ ] User A sends "hi" → User B sees it in real-time, unread badge increments if chat is closed
- [ ] User A clicks smile → reaction floats up bottom-right with name underneath
- [ ] User A clicks hand → User A's tile gets an amber hand badge top-left; visible to User B
- [ ] User A clicks hand again → badge clears

## 5. Captions (legacy speech recognition)

- [ ] (Only if the legacy MeetRoom is in use somewhere also — captions don't auto-publish from this room yet). Skip unless you test against an old room.

## 6. Whiteboard

- [ ] Click the pencil icon → whiteboard opens over the stage
- [ ] User A draws a line — User B sees it appear
- [ ] User A clicks close → whiteboard hides; existing strokes persist on next open

## 7. People panel + host actions

User A is the host.

- [ ] Click the People (users-round) icon → sidebar lists both participants, A at top with a Crown icon
- [ ] Click the **promote (UserPlus)** icon next to User B → B becomes "Co-host" badge in the row
- [ ] Click promote again → demotes back to Participant
- [ ] Click the **remove (UserMinus)** icon next to User B → confirms, User B is kicked, B's browser redirects to /meet
- [ ] Have User B rejoin

## 8. Host menu

- [ ] In the top-right header (host only), click **Host** dropdown
- [ ] Toggle "Lock meeting" → other user trying to join now should get 403
- [ ] Unlock
- [ ] Toggle "Disable chat" → User B's composer becomes disabled with placeholder
- [ ] Re-enable
- [ ] Toggle "Disable screen share" → User B can't start a share
- [ ] Re-enable

## 9. Waiting room (host-only)

This requires `waiting_room_enabled: true` at create time (default).

- [ ] User C opens `/meet/<code>` and clicks Join — should be held at "Waiting for host…"
- [ ] User A's room → Waiting badge (users icon) shows unread count
- [ ] Click it → C is in the list
- [ ] Click Admit → C is admitted, lands in the room
- [ ] (alt) Click Deny → C sees "denied" and gets bounced

## 10. Devices

- [ ] Click gear icon → device picker shows mic / camera / speaker dropdowns
- [ ] Switch mic → the tile audio should now come from the new mic (test by speaking)
- [ ] Switch camera → tile video updates
- [ ] Close picker, refresh the page (rejoin) — picker remembers your selection

## 11. Keyboard shortcuts

- [ ] `Ctrl/Cmd + D` → toggles mic (matches Google Meet)
- [ ] `Ctrl/Cmd + E` → toggles camera

## 12. Muted-but-speaking nudge

- [ ] Mute mic
- [ ] Speak for ~1 second
- [ ] Toast appears bottom-center: "You're muted — press Ctrl+D to unmute"
- [ ] Stop speaking → toast auto-dismisses after ~2.5s

## 13. Network quality bars

- [ ] In Chrome DevTools → Network tab → set throttling to **Slow 3G**
- [ ] Within ~10s, network quality bars should appear on tiles (amber or red)
- [ ] Return to "No throttling" → bars hide once Excellent

## 14. Reconnect

- [ ] DevTools → Application → Service Workers → Offline (or just kill wifi briefly)
- [ ] Top of screen shows an amber "Reconnecting to the meeting…" toast
- [ ] Re-enable network → toast clears, call resumes

## 15. Recording (host-only)

- [ ] Click the red circle icon (host only) — recording starts
- [ ] Header shows "REC" indicator with red pulsing dot
- [ ] Have both users move/talk for ~30 s
- [ ] Click circle again → recording stops
- [ ] After ~10 s, an MP4 file should land in `zoiko_recordings` Docker volume
  - Verify: `docker run --rm -v zoiko_meet_zoiko_recordings:/r alpine ls -la /r`
- [ ] In the DB, the recording row should flip `recording → ready`:
  - `docker exec zoiko-db psql -U zoiko -d zoiko -c "SELECT id, status, file_name, file_size, duration FROM meeting_recordings ORDER BY id DESC LIMIT 5;"`
- [ ] Visit the **Recordings** page in the app and confirm the new row shows up with a working playback link

## 16. End meeting

- [ ] Host menu → "End meeting for all"
- [ ] Confirm dialog
- [ ] Both clients redirect to `/meet`
- [ ] DB: meeting row is `is_active=false`, `ended_at` is set, `media_room_ref` is null

## 17. Error boundary

- [ ] In DevTools → React DevTools → manually crash a child component (or temporarily insert `throw new Error('boom')` somewhere in `Stage.jsx`)
- [ ] Screen shows the "Something broke in the call view" fallback with Reload + Back buttons
- [ ] (Revert the throw)

## What to file as a bug

- Any tile that re-mounts on every chat message (look for `<video>` flickering)
- Any layout that doesn't fit on mobile width
- Reactions / toasts that stack forever
- Audio echo
- Reconnect that hangs > 30 s
- Recording row stuck at `recording` after stop > 30 s

## When the above all passes

1. Set `VITE_USE_LIVEKIT=1` in `.env` so all meetings (including old `media_provider=mesh` ones in the DB) route to the LK room
2. Wait 1–2 weeks of real use
3. Delete legacy mesh code (see [`docs/livekit-migration-cleanup.md`](livekit-migration-cleanup.md) — TBD)
