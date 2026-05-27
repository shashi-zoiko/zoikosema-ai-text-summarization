import Icon from './Icon'
import Avatar from './Avatar'
import { useCall } from '../context/CallContext'

/* ─────────────────────────────────────────────────────────────────────────
 * CallOverlay — full-screen incoming/outgoing call modal.
 * Companion CallOverlay.css gone. The pulsing ring uses the `zk-call-ring`
 * keyframe (index.css); three concentric rings cascade 0.5s apart for the
 * continuous "ringing" effect.
 * ──────────────────────────────────────────────────────────────────────── */

const SHELL_CLASS =
  'fade-in fixed inset-0 z-[1000] grid place-items-center bg-[rgba(15,17,26,0.55)] backdrop-blur-md'

const CARD_CLASS =
  'scale-in flex min-w-[320px] max-w-[380px] flex-col items-center gap-3.5 rounded-[20px] border border-line bg-surface px-7 pt-8 pb-6 text-center shadow-[0_24px_60px_rgba(10,12,20,0.25)]'

const RINGING_LABEL =
  'text-[12px] font-semibold uppercase tracking-[0.04em] text-fg-muted'

export default function CallOverlay() {
  const { incoming, outgoing, acceptIncoming, declineIncoming, cancelOutgoing } = useCall()

  if (incoming) {
    const kindLabel = incoming.kind === 'audio' ? 'audio call' : 'video call'
    return (
      <div className={SHELL_CLASS}>
        <div className={CARD_CLASS}>
          <div className={RINGING_LABEL}>Incoming {kindLabel}</div>
          <AvatarWrap pulsing>
            <Avatar name={incoming.caller.name} color={incoming.caller.avatar_color} size="xl" />
          </AvatarWrap>
          <div className="text-[20px] font-bold text-fg">{incoming.caller.name}</div>
          <div className="mt-2 flex gap-7">
            <CallBtn tone="decline" onClick={declineIncoming} title="Decline">
              <Icon name="phoneOff" size={22} />
            </CallBtn>
            <CallBtn tone="accept" onClick={acceptIncoming} title="Accept">
              <Icon name={incoming.kind === 'audio' ? 'phone' : 'video'} size={22} />
            </CallBtn>
          </div>
        </div>
      </div>
    )
  }

  if (outgoing) {
    const kindLabel = outgoing.kind === 'audio' ? 'audio call' : 'video call'
    return (
      <div className={SHELL_CLASS}>
        <div className={CARD_CLASS}>
          <div className={RINGING_LABEL}>
            {outgoing.declined ? 'Call declined' : `Calling… · ${kindLabel}`}
          </div>
          <AvatarWrap pulsing={!outgoing.declined}>
            <Avatar name={outgoing.callee.name} color={outgoing.callee.avatar_color} size="xl" />
          </AvatarWrap>
          <div className="text-[20px] font-bold text-fg">{outgoing.callee.name}</div>
          <div className="mt-2 flex gap-7">
            <CallBtn tone="decline" onClick={cancelOutgoing} title={outgoing.declined ? 'Close' : 'Cancel'}>
              <Icon name="phoneOff" size={22} />
            </CallBtn>
          </div>
        </div>
      </div>
    )
  }

  return null
}

/* ────────────────────── pieces ────────────────────── */

function AvatarWrap({ children, pulsing }) {
  return (
    <div className="relative grid h-[120px] w-[120px] place-items-center">
      {pulsing && (
        <>
          <Ring />
          <Ring delay="0.5s" />
          <Ring delay="1s" />
        </>
      )}
      {children}
    </div>
  )
}

function Ring({ delay = '0s' }) {
  return (
    <span
      aria-hidden
      className="zk-call-ring absolute inset-0 rounded-full border-2"
      style={{
        borderColor: delay === '0s' ? 'rgba(124,140,255,0.5)' : 'rgba(124,140,255,0.35)',
        animationDelay: delay,
      }}
    />
  )
}

function CallBtn({ children, onClick, title, tone }) {
  const bg = tone === 'accept'
    ? 'linear-gradient(135deg, #22c55e, #16a34a)'
    : 'linear-gradient(135deg, #ef4444, #dc2626)'
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="grid h-14 w-14 cursor-pointer place-items-center !rounded-full !border-0 !p-0 text-white shadow-[0_6px_16px_rgba(0,0,0,0.18)] transition active:translate-y-0 hover:-translate-y-0.5 hover:brightness-[1.05]"
      style={{ background: bg }}
    >
      {children}
    </button>
  )
}
