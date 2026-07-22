import { describe, it, expect, beforeEach } from 'vitest'
import { FLAGS, isFlagEnabled, setFlag, subscribeFlags, __resetFlagOverrides } from './flags.js'

describe('feature flags (ZS-MTG-IMP-04)', () => {
  beforeEach(() => __resetFlagOverrides())

  it('the two gating flags default ON in production; the rest are inert (off)', () => {
    expect(isFlagEnabled(FLAGS.MEETING_CENTER_V3)).toBe(true)
    expect(isFlagEnabled(FLAGS.PEOPLE_TAB_V3)).toBe(true)
    const inert = [FLAGS.ADMISSIONS_V3, FLAGS.PEOPLE_ACTIONS_V3, FLAGS.PEOPLE_SEARCH_FILTERS_V3, FLAGS.PEOPLE_REALTIME_V3, FLAGS.MOBILE_MEETING_CENTER_SHARED_MODEL]
    for (const name of inert) expect(isFlagEnabled(name)).toBe(false)
  })

  it('kill switch: an explicit "0" override still disables a defaulted-on flag', () => {
    setFlag(FLAGS.PEOPLE_TAB_V3, false)
    expect(isFlagEnabled(FLAGS.PEOPLE_TAB_V3)).toBe(false)
  })

  it('setFlag toggles a flag at runtime (in-memory override wins)', () => {
    setFlag(FLAGS.PEOPLE_TAB_V3, true)
    expect(isFlagEnabled(FLAGS.PEOPLE_TAB_V3)).toBe(true)
    setFlag(FLAGS.PEOPLE_TAB_V3, false)
    expect(isFlagEnabled(FLAGS.PEOPLE_TAB_V3)).toBe(false)
  })

  it('clearing an override (null) falls back to default', () => {
    setFlag(FLAGS.ADMISSIONS_V3, true)
    expect(isFlagEnabled(FLAGS.ADMISSIONS_V3)).toBe(true)
    setFlag(FLAGS.ADMISSIONS_V3, null)
    expect(isFlagEnabled(FLAGS.ADMISSIONS_V3)).toBe(false)
  })

  it('notifies subscribers on change (runtime rollback signal)', () => {
    let hits = 0
    const unsub = subscribeFlags(() => { hits++ })
    setFlag(FLAGS.PEOPLE_REALTIME_V3, true)
    expect(hits).toBe(1)
    unsub()
    setFlag(FLAGS.PEOPLE_REALTIME_V3, false)
    expect(hits).toBe(1)
  })
})
