import { memo } from 'react'
import { Hand, MicOff, VideoOff, MonitorUp, ShieldCheck, Pin, Check, X, Loader2, AlertTriangle } from 'lucide-react'
import { usePeopleApi } from './PeopleProvider.jsx'
import { ROLE, STATUS, ACTION, DEVICE, CONN, PENDING_STATE } from '../constants.js'
import RowActionsMenu from './RowActionsMenu.jsx'

export const ROW_H = 56

const ROLE_LABEL = { [ROLE.HOST]: 'Host', [ROLE.COHOST]: 'Co-host', [ROLE.PARTICIPANT]: 'Participant' }

function initialsOf(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?'
}

function accessibleName(p) {
  const bits = [p.name || 'Guest']
  if (p.isSelf) bits.push('you')
  bits.push(ROLE_LABEL[p.role] || 'Participant')
  if (p.isGuest) bits.push('external guest')
  if (p.status === STATUS.WAITING) bits.push('waiting to join')
  if (p.handRaised) bits.push('hand raised')
  if (p.presenting) bits.push('sharing screen')
  if (p.mic === DEVICE.OFF) bits.push('muted')
  if (p.camera === DEVICE.OFF) bits.push('camera off')
  if (p.connection === CONN.ATTENTION) bits.push('connection needs attention')
  if (p.sessions > 1) bits.push(`${p.sessions} sessions`)
  return bits.join(', ')
}

function StateIcon({ icon, label, tone = 'muted' }) {
  const Cmp = icon
  const cls = tone === 'warn' ? 'text-amber-400' : tone === 'alert' ? 'text-red-400' : 'text-[#94A3B8]'
  return (
    <span className={'inline-flex ' + cls} title={label}>
      <Cmp className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

function ParticipantRow({ person, speaking = false, pinned = false }) {
  const api = usePeopleApi()
  const resolved = api.rowActions({ ...person, pinned })
  const can = (id) => resolved.some((a) => a.action === id && a.available)
  const pending = person.pending
  const isPending = pending?.state === PENDING_STATE.PENDING
  const isFailed = pending?.state === PENDING_STATE.FAILED

  const admit = () => api.actions.admit(person.key, person.userId)
  const deny = () => api.actions.deny(person.key, person.userId)
  const promote = () => api.actions.promote(person.key, person.userId)
  const demote = () => api.actions.demote(person.key, person.userId)
  const pin = () => api.pin?.(person.userId)

  const overflow = []
  if (can(ACTION.PROMOTE)) overflow.push({ id: 'promote', label: 'Make co-host', onSelect: promote })
  if (can(ACTION.DEMOTE)) overflow.push({ id: 'demote', label: 'Remove co-host', onSelect: demote })

  return (
    <li
      role="listitem"
      aria-label={accessibleName(person)}
      style={{ height: ROW_H }}
      className={
        'group flex items-center gap-3 px-3 ' +
        (isFailed ? 'bg-red-500/5 ' : '')
      }
      data-person-key={person.key}
    >
      {/* Avatar + speaking ring */}
      <span
        className={
          'relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white ' +
          (speaking ? 'ring-2 ring-[#10B981]' : 'ring-1 ring-white/10')
        }
        style={{ background: person.color || '#334155' }}
        aria-hidden="true"
      >
        {person.avatarUrl
          ? <img src={person.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
          : initialsOf(person.name)}
      </span>

      {/* Identity + badges */}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[14px] font-medium text-white">{person.name || 'Guest'}</span>
          {person.isSelf && <span className="text-[11px] text-[#94A3B8]">(you)</span>}
          {(person.role === ROLE.HOST || person.role === ROLE.COHOST) && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-[#10B981]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#34D399] ring-1 ring-[#10B981]/30">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              {ROLE_LABEL[person.role]}
            </span>
          )}
          {person.isGuest && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300 ring-1 ring-amber-500/30">
              External
            </span>
          )}
        </span>
        {person.sessions > 1 && (
          <span className="text-[11px] text-[#64748B]">{person.sessions} sessions</span>
        )}
      </span>

      {/* State indicators (decorative; row aria-label carries the full summary) */}
      <span className="flex items-center gap-1.5">
        {person.handRaised && <StateIcon icon={Hand} label="Hand raised" tone="warn" />}
        {person.presenting && <StateIcon icon={MonitorUp} label="Sharing screen" />}
        {person.connection === CONN.ATTENTION && <StateIcon icon={AlertTriangle} label="Connection attention" tone="alert" />}
        {person.mic === DEVICE.OFF && <StateIcon icon={MicOff} label="Muted" />}
        {person.camera === DEVICE.OFF && <StateIcon icon={VideoOff} label="Camera off" />}
      </span>

      {/* Actions */}
      <span className="flex shrink-0 items-center gap-1">
        {isPending && <Loader2 className="h-4 w-4 animate-spin text-[#94A3B8]" aria-label="Action pending" />}
        {isFailed && (
          <button
            type="button"
            onClick={() => (person.status === STATUS.WAITING ? admit() : promote())}
            aria-label={`Retry action for ${person.name || 'participant'}`}
            className="inline-flex items-center gap-1 rounded-md !bg-transparent !border-0 !p-0 !shadow-none px-1.5 text-[11px] text-red-300 hover:text-red-200"
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Retry
          </button>
        )}

        {person.status === STATUS.WAITING ? (
          <>
            {can(ACTION.DENY) && (
              <button
                type="button" onClick={deny} disabled={isPending}
                aria-label={`Deny ${person.name || 'guest'}`}
                className="grid h-8 w-8 place-items-center rounded-full !bg-transparent !border-0 !p-0 !shadow-none text-[#94A3B8] hover:!bg-red-500/15 hover:text-red-300 disabled:opacity-40"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            {can(ACTION.ADMIT) && (
              <button
                type="button" onClick={admit} disabled={isPending}
                aria-label={`Admit ${person.name || 'guest'}`}
                className="inline-flex h-8 items-center gap-1 rounded-full border-0 bg-[#10B981] px-3 text-[12px] font-semibold text-[#04140D] shadow-none hover:bg-[#0EA972] disabled:opacity-40"
              >
                <Check className="h-4 w-4" aria-hidden="true" /> Admit
              </button>
            )}
          </>
        ) : (
          <>
            <button
              type="button" onClick={pin}
              aria-label={pinned ? `Unpin ${person.name || 'participant'}` : `Pin ${person.name || 'participant'}`}
              aria-pressed={pinned}
              className={
                'grid h-8 w-8 place-items-center rounded-full !bg-transparent !border-0 !p-0 !shadow-none hover:!bg-white/10 ' +
                (pinned ? 'text-[#10B981]' : 'text-[#94A3B8] opacity-0 group-hover:opacity-100 focus:opacity-100')
              }
            >
              <Pin className="h-4 w-4" aria-hidden="true" />
            </button>
            {overflow.length > 0 && (
              <RowActionsMenu items={overflow} label={`Actions for ${person.name || 'participant'}`} />
            )}
          </>
        )}
      </span>
    </li>
  )
}

export default memo(ParticipantRow)
