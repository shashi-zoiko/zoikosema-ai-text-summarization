/**
 * LobbyLeaves — ambient botanical decoration for the meeting lobby.
 *
 * Purely decorative: rendered behind the content, translucent, softly
 * blurred and slowly swaying so it reads as a natural watercolour wash
 * (matching the brand template) without ever stealing attention from the
 * preview or the join controls. `pointer-events-none` + low z-index keep it
 * inert; `aria-hidden` keeps it out of the accessibility tree.
 */

const LEAVES = [
  { x: 70, y: 185, rot: -55, scale: 1.20, tone: 'deep' },
  { x: 102, y: 170, rot: 40, scale: 1.05, tone: 'light' },
  { x: 92, y: 140, rot: -66, scale: 1.00, tone: 'light' },
  { x: 130, y: 126, rot: 54, scale: 0.95, tone: 'deep' },
  { x: 118, y: 100, rot: -58, scale: 0.86, tone: 'light' },
  { x: 146, y: 90, rot: 34, scale: 0.80, tone: 'deep' },
  { x: 150, y: 62, rot: 8, scale: 0.78, tone: 'light' },
]

function leafPath(len = 78, w = 26) {
  return `M0 0 C ${w} ${-len * 0.3} ${w * 0.7} ${-len * 0.82} 0 ${-len} ` +
    `C ${-w * 0.7} ${-len * 0.82} ${-w} ${-len * 0.3} 0 0 Z`
}

function Sprig({ id }) {
  const d = leafPath()
  return (
    <svg viewBox="0 0 240 240" fill="none" className="h-full w-full">
      <defs>
        {/* Dark-mode tones: bright, luminous emerald that glows against #0B1220
            rather than the old pale watercolour wash (which vanished on dark). */}
        <linearGradient id={`${id}-light`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6EE7B7" />
          <stop offset="55%" stopColor="#34D399" />
          <stop offset="100%" stopColor="#0E7A56" />
        </linearGradient>
        <linearGradient id={`${id}-deep`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34D399" />
          <stop offset="100%" stopColor="#0A5A41" />
        </linearGradient>
        {/* Specular sheen — a soft light running down one side of each blade */}
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(209,250,229,0.85)" />
          <stop offset="60%" stopColor="rgba(209,250,229,0)" />
        </linearGradient>
      </defs>
      {/* stem */}
      <path
        d="M60 232 C 82 172, 122 150, 152 58"
        stroke="#3DDC97"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
        opacity="0.7"
      />
      {LEAVES.map((l, i) => (
        <g key={i} transform={`translate(${l.x} ${l.y}) rotate(${l.rot}) scale(${l.scale})`}>
          <path d={d} fill={`url(#${id}-${l.tone})`} />
          {/* specular highlight — gives each leaf a lit, glossy edge */}
          <path d={d} fill={`url(#${id}-sheen)`} opacity="0.5" />
          {/* central vein — bright emerald highlight catches the light */}
          <path d="M0 0 L 0 -78" stroke="rgba(214,255,235,0.7)" strokeWidth="1.3" opacity="0.7" />
        </g>
      ))}
    </svg>
  )
}

export default function LobbyLeaves() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {/* Ambient emerald glow pools anchoring each sprig — gives the dark
          canvas depth so the foliage feels lit rather than pasted on. */}
      <div
        className="absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full opacity-90"
        style={{ background: 'radial-gradient(circle, rgba(52,211,153,0.24), transparent 68%)' }}
      />
      <div
        className="absolute -bottom-28 -right-24 h-[560px] w-[560px] rounded-full opacity-100"
        style={{ background: 'radial-gradient(circle, rgba(52,211,153,0.26), transparent 66%)' }}
      />

      {/* top-left sprig — drapes down into the frame */}
      <div
        className="absolute -left-10 -top-8 h-[230px] w-[230px] opacity-85 sm:h-[270px] sm:w-[270px]"
        style={{ transform: 'rotate(176deg)', filter: 'blur(0.3px) drop-shadow(0 0 26px rgba(52,211,153,0.45))' }}
      >
        <div className="zk-leaf-sway h-full w-full" style={{ animationDuration: '11s' }}>
          <Sprig id="leaf-tl" />
        </div>
      </div>

      {/* bottom-right branch — the prominent one, sweeping inward */}
      <div
        className="absolute -bottom-12 -right-10 h-[360px] w-[360px] opacity-100 sm:h-[460px] sm:w-[460px]"
        style={{ transform: 'scaleX(-1)', filter: 'blur(0.3px) drop-shadow(0 0 34px rgba(52,211,153,0.5))' }}
      >
        <div className="zk-leaf-sway h-full w-full" style={{ animationDuration: '14s', animationDelay: '-3s' }}>
          <Sprig id="leaf-br" />
        </div>
      </div>
    </div>
  )
}
