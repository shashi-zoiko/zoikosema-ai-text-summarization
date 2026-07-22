import { describe, it, expect } from 'vitest'
import {
  deriveViewerCapabilities, resolveRowActions, resolveQueueActions, availableActions, PROHIBITED_ACTIONS,
} from './capabilities.js'
import { ACTION, ROLE, STATUS } from './constants.js'

describe('capability derivation mirrors server authority', () => {
  it('host can admit/promote/demote; co-host can admit but not promote; participant nothing', () => {
    const host = deriveViewerCapabilities({ role: ROLE.HOST })
    expect(host.admit && host.promote && host.demote).toBe(true)
    const cohost = deriveViewerCapabilities({ role: ROLE.COHOST })
    expect(cohost.admit).toBe(true)
    expect(cohost.promote).toBe(false) // promote is host-only server-side
    const guest = deriveViewerCapabilities({ role: ROLE.PARTICIPANT })
    expect(guest.admit || guest.promote).toBe(false)
  })
})

describe('row action resolution (server-capability driven)', () => {
  const hostCaps = deriveViewerCapabilities({ role: ROLE.HOST })
  const partCaps = deriveViewerCapabilities({ role: ROLE.PARTICIPANT })

  it('offers admit/deny only for waiting people, only to authorized viewers', () => {
    const target = { key: '9', status: STATUS.WAITING, role: ROLE.PARTICIPANT }
    expect(availableActions(resolveRowActions({ viewerCaps: hostCaps, target }))).toEqual([ACTION.ADMIT, ACTION.DENY])
    expect(availableActions(resolveRowActions({ viewerCaps: partCaps, target }))).toEqual([])
  })

  it('offers promote for a participant to a host, but never on self', () => {
    const target = { key: '2', status: STATUS.ACTIVE, role: ROLE.PARTICIPANT }
    expect(availableActions(resolveRowActions({ viewerCaps: hostCaps, viewerKey: '1', target })))
      .toContain(ACTION.PROMOTE)
    // self → no promote
    expect(availableActions(resolveRowActions({ viewerCaps: hostCaps, viewerKey: '2', target: { ...target, isSelf: true } })))
      .not.toContain(ACTION.PROMOTE)
  })

  it('offers demote for a co-host to a host', () => {
    const target = { key: '3', status: STATUS.ACTIVE, role: ROLE.COHOST }
    expect(availableActions(resolveRowActions({ viewerCaps: hostCaps, viewerKey: '1', target }))).toContain(ACTION.DEMOTE)
  })

  it('pin/unpin is always available (local view control, not a server mutation)', () => {
    const target = { key: '2', status: STATUS.ACTIVE, role: ROLE.PARTICIPANT }
    expect(availableActions(resolveRowActions({ viewerCaps: partCaps, target }))).toContain(ACTION.PIN)
  })

  it('NEVER yields remote-unmute / remote-camera / mute / remove / spotlight', () => {
    const targets = [
      { key: '2', status: STATUS.ACTIVE, role: ROLE.PARTICIPANT, mic: 'off', camera: 'off' },
      { key: '9', status: STATUS.WAITING, role: ROLE.PARTICIPANT },
      { key: '3', status: STATUS.ACTIVE, role: ROLE.COHOST },
    ]
    const forbidden = new Set([...PROHIBITED_ACTIONS, 'mute', 'stop_video', 'remove', 'kick', 'spotlight'])
    for (const target of targets) {
      const acts = resolveRowActions({ viewerCaps: hostCaps, viewerKey: '1', target }).map((a) => a.action)
      for (const f of forbidden) expect(acts).not.toContain(f)
    }
  })
})

describe('queue actions', () => {
  it('admit-all available to authorized viewer only when queue non-empty', () => {
    const hostCaps = deriveViewerCapabilities({ role: ROLE.HOST })
    expect(availableActions(resolveQueueActions({ viewerCaps: hostCaps, waitingCount: 3 }))).toEqual([ACTION.ADMIT_ALL])
    expect(availableActions(resolveQueueActions({ viewerCaps: hostCaps, waitingCount: 0 }))).toEqual([])
  })
})
