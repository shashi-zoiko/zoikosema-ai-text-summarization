import { useEffect, useRef, useState } from 'react'

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)

export default function CountUp({ value = 0, duration = 900, format, className }) {
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)
  const rafRef = useRef(0)

  useEffect(() => {
    const from = fromRef.current
    const to = Number(value) || 0
    const start = performance.now()
    cancelAnimationFrame(rafRef.current)
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = easeOutCubic(t)
      const current = from + (to - from) * eased
      setDisplay(current)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
      else fromRef.current = to
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value, duration])

  const out = format ? format(display) : Math.round(display).toLocaleString()
  return <span className={className}>{out}</span>
}
