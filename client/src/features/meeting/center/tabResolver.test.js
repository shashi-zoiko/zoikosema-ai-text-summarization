import { describe, it, expect, beforeEach } from 'vitest'
import { resolveTabs, visibleTabs, nearestAvailableTab, initialTab } from './tabResolver.js'
import { TAB } from './tabRegistry.js'
import { FLAGS, setFlag, __resetFlagOverrides } from '../../../lib/flags.js'

describe('tab resolver', () => {
  beforeEach(() => __resetFlagOverrides())

  it('People defaults available; an explicit flag-off hides it; Chat only when hosted', () => {
    // Default ON in production.
    expect(resolveTabs({}).find((t) => t.id === TAB.PEOPLE).available).toBe(true)
    // Kill switch: explicit off → unavailable with reason.
    setFlag(FLAGS.PEOPLE_TAB_V3, false)
    const people = resolveTabs({}).find((t) => t.id === TAB.PEOPLE)
    expect(people.available).toBe(false)
    expect(people.reason).toBe('flag_off')
    // Chat is implemented but hidden until the integration wires the chat slot.
    expect(resolveTabs({}).find((t) => t.id === TAB.CHAT).available).toBe(false)
    expect(resolveTabs({ chatHosted: true }).find((t) => t.id === TAB.CHAT).available).toBe(true)
  })

  it('Steward/Tools are always hidden in this release; Host is host-only but still deferred', () => {
    const tabs = resolveTabs({ isHostOrCohost: true })
    expect(tabs.find((t) => t.id === TAB.STEWARD).visible).toBe(false)
    expect(tabs.find((t) => t.id === TAB.TOOLS).visible).toBe(false)
    expect(tabs.find((t) => t.id === TAB.HOST).available).toBe(false) // deferred wins over capability
  })

  it('badges compute from live context', () => {
    setFlag(FLAGS.PEOPLE_TAB_V3, true)
    const tabs = resolveTabs({ waitingCount: 3, raisedCount: 2 })
    expect(tabs.find((t) => t.id === TAB.PEOPLE).badge).toBe(5)
  })

  it('nearestAvailableTab keeps the active tab if available, else falls back to People', () => {
    setFlag(FLAGS.PEOPLE_TAB_V3, true)
    const tabs = resolveTabs({ chatHosted: true })
    expect(nearestAvailableTab(tabs, TAB.CHAT)).toBe(TAB.CHAT)
    // steward not available → nearest is People (default)
    expect(nearestAvailableTab(tabs, TAB.STEWARD)).toBe(TAB.PEOPLE)
  })

  it('auto-switches away from a tab that becomes unavailable', () => {
    setFlag(FLAGS.PEOPLE_TAB_V3, true)
    let tabs = resolveTabs({ chatHosted: true })
    expect(nearestAvailableTab(tabs, TAB.PEOPLE)).toBe(TAB.PEOPLE)
    setFlag(FLAGS.PEOPLE_TAB_V3, false) // People pulled → switch to Chat
    tabs = resolveTabs({ chatHosted: true })
    expect(nearestAvailableTab(tabs, TAB.PEOPLE)).toBe(TAB.CHAT)
  })

  it('initialTab prefers People when available', () => {
    setFlag(FLAGS.PEOPLE_TAB_V3, true)
    expect(initialTab(resolveTabs({}))).toBe(TAB.PEOPLE)
  })

  it('visibleTabs returns only renderable tabs in order', () => {
    setFlag(FLAGS.PEOPLE_TAB_V3, true)
    const vis = visibleTabs(resolveTabs({ chatHosted: true }))
    expect(vis.map((t) => t.id)).toEqual([TAB.PEOPLE, TAB.CHAT])
  })
})
