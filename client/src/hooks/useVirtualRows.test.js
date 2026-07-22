import { describe, it, expect } from 'vitest'
import { computeWindow } from './useVirtualRows.js'

describe('computeWindow (virtualization math)', () => {
  it('returns the full range when nothing is scrolled', () => {
    const w = computeWindow({ scrollTop: 0, viewportH: 560, rowH: 56, count: 500, overscan: 6 })
    expect(w.start).toBe(0)
    expect(w.end).toBeGreaterThan(0)
    expect(w.end).toBeLessThan(500) // windowed, not all 500 mounted
    expect(w.padTop).toBe(0)
    expect(w.padBottom).toBe((500 - w.end) * 56)
  })

  it('windows around the scroll offset with overscan', () => {
    const w = computeWindow({ scrollTop: 56 * 100, viewportH: 560, rowH: 56, count: 500, overscan: 6 })
    expect(w.start).toBe(100 - 6) // first visible minus overscan
    expect(w.padTop).toBe(w.start * 56)
    // Mounted rows are bounded (viewport + 2*overscan), NOT 500.
    expect(w.end - w.start).toBeLessThan(40)
  })

  it('clamps at the end of the list', () => {
    const w = computeWindow({ scrollTop: 56 * 500, viewportH: 560, rowH: 56, count: 500, overscan: 6 })
    expect(w.end).toBe(500)
    expect(w.padBottom).toBe(0)
  })

  it('handles empty and zero-height safely', () => {
    expect(computeWindow({ scrollTop: 0, viewportH: 500, rowH: 56, count: 0 })).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 })
    expect(computeWindow({ scrollTop: 0, viewportH: 500, rowH: 0, count: 10 })).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 })
  })

  it('keeps the mounted set bounded across a 500-row sweep (perf posture)', () => {
    let maxMounted = 0
    for (let top = 0; top <= 56 * 500; top += 56 * 10) {
      const w = computeWindow({ scrollTop: top, viewportH: 560, rowH: 56, count: 500, overscan: 6 })
      maxMounted = Math.max(maxMounted, w.end - w.start)
    }
    expect(maxMounted).toBeLessThan(40) // never mounts anywhere near 500 rows
  })
})
