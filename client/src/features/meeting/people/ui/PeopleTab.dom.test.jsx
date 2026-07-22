// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PeopleProvider } from './PeopleProvider.jsx'
import PeopleTab from './PeopleTab.jsx'
import { ROLE } from '../constants.js'

const seed = {
  peers: [
    { user_id: 1, identity: 'u:1', name: 'Alice', role: ROLE.HOST },
    { user_id: 2, identity: 'u:2', name: 'Bob', role: ROLE.PARTICIPANT },
  ],
  waiting: [{ user_id: 9001, name: 'Guest 9001', is_guest: true, joined_at: 1 }],
}

function renderPeople({ viewer = { role: ROLE.HOST, userId: 1 }, actionTransport, mediaPeers = [] } = {}) {
  const transport = { send: vi.fn(), subscribe: () => () => {} }
  const at = actionTransport || { admit: vi.fn().mockResolvedValue({}), deny: vi.fn().mockResolvedValue({}), promote: vi.fn().mockResolvedValue({}), demote: vi.fn().mockResolvedValue({}), admitAll: vi.fn().mockResolvedValue({}) }
  render(
    <PeopleProvider
      transport={transport}
      connected
      mediaPeers={mediaPeers}
      viewer={viewer}
      actionTransport={at}
      seed={seed}
      search=""
      filters={[]}
      onSearch={() => {}}
      onToggleFilter={() => {}}
    >
      <PeopleTab />
    </PeopleProvider>,
  )
  return { actionTransport: at }
}

describe('PeopleTab (DOM)', () => {
  it('renders canonical groups with one row per participant', async () => {
    renderPeople()
    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Guest 9001')).toBeInTheDocument()
    // Group headers (one participant → one group)
    expect(screen.getByText(/Hosts · 1/i)).toBeInTheDocument()
    expect(screen.getByText(/Participants · 1/i)).toBeInTheDocument()
    expect(screen.getByText(/Waiting · 1/i)).toBeInTheDocument()
  })

  it('a host sees Admit on a waiting row, and clicking calls the transport (idempotent key)', async () => {
    const { actionTransport } = renderPeople()
    const admitBtn = await screen.findByRole('button', { name: /admit guest 9001/i })
    fireEvent.click(admitBtn)
    expect(actionTransport.admit).toHaveBeenCalledTimes(1)
    expect(actionTransport.admit).toHaveBeenCalledWith(9001, expect.objectContaining({ idemKey: expect.any(String) }))
  })

  it('offers Admit All in the waiting section header', async () => {
    const { actionTransport } = renderPeople()
    const admitAll = await screen.findByRole('button', { name: /admit all/i })
    fireEvent.click(admitAll)
    expect(actionTransport.admitAll).toHaveBeenCalledTimes(1)
  })

  it('NEVER renders mute / remove / stop-video controls (forbidden here)', async () => {
    renderPeople()
    await screen.findByText('Alice')
    // Word-boundary patterns so the "Muted" FILTER chip is not mistaken for a
    // mute ACTION. No participant action to mute/remove/stop-video/unmute exists.
    expect(screen.queryByRole('button', { name: /\bmute\b/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /\bremove\b/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /stop video/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /\bunmute\b|turn on (mic|camera)/i })).toBeNull()
  })

  it('a non-privileged viewer gets no admit control (server-capability driven)', async () => {
    renderPeople({ viewer: { role: ROLE.PARTICIPANT, userId: 2 } })
    await screen.findByText('Alice')
    expect(screen.queryByRole('button', { name: /admit guest/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /admit all/i })).toBeNull()
  })

  it('rows expose an accessible participant summary', async () => {
    renderPeople()
    // Row aria-label carries role + state for screen readers.
    expect(await screen.findByRole('listitem', { name: /Alice.*Host/i })).toBeInTheDocument()
  })

  it('renders mic-off / camera-off state indicators without crashing (regression)', async () => {
    // Regression for the StateIcon `icon` prop: a muted / camera-off participant
    // must render its indicators. Fixtures previously left mic/camera unknown, so
    // this path was never exercised and a prop-name mismatch slipped through.
    renderPeople({ mediaPeers: [{ identity: 'u:1', mic: 'off', camera: 'off' }, { identity: 'u:2' }] })
    expect(await screen.findByRole('listitem', { name: /Alice.*muted.*camera off/i })).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })
})
