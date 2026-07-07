// Small "Guest" pill shown next to anonymous participants' names across the
// meeting UI (waiting room, people panel, tiles, chat). Keeps the visual
// treatment in one place so guests read consistently everywhere.
export default function GuestBadge({ className = '' }) {
  return (
    <span
      className={
        'inline-flex shrink-0 items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 ' +
        'text-[10px] font-semibold uppercase tracking-wide text-amber-300 ring-1 ring-amber-500/30 ' +
        className
      }
    >
      Guest
    </span>
  )
}

/** Read the guest flag off a LiveKit participant's metadata (set server-side
 *  in livekit_provider.generate_token). Returns false on any parse error. */
export function isGuestParticipant(participant) {
  try {
    const meta = participant?.metadata ? JSON.parse(participant.metadata) : null
    return !!meta?.guest
  } catch {
    return false
  }
}

/** Read the uploaded profile-photo URL off a participant's metadata (set
 *  server-side in generate_token). Returns null when absent or unparseable. */
export function participantAvatarUrl(participant) {
  try {
    const meta = participant?.metadata ? JSON.parse(participant.metadata) : null
    return meta?.avatarUrl || null
  } catch {
    return null
  }
}
