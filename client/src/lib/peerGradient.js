// Deterministic per-peer gradient. Same name/color → same gradient on every
// render and across reloads, so a participant feels like they "own" their tile.
//
// Curated AI-native palette: each entry is a (from, mid, to) triple that
// reads well at 32-color contrast over white text. The end colors are
// chosen to be far enough apart hue-wise to feel like an aurora gradient
// rather than a single tint.

const PALETTE = [
  // A → orange + crimson aurora
  { from: '#fb923c', mid: '#f43f5e', to: '#a21caf', glow: '#f43f5e' },
  // H → electric blue + cyan
  { from: '#06b6d4', mid: '#3b82f6', to: '#8b5cf6', glow: '#06b6d4' },
  // S → violet + pink aurora
  { from: '#a78bfa', mid: '#ec4899', to: '#f97316', glow: '#a78bfa' },
  // M → emerald + teal
  { from: '#10b981', mid: '#14b8a6', to: '#0ea5e9', glow: '#10b981' },
  // K → indigo + magenta
  { from: '#6366f1', mid: '#a855f7', to: '#ec4899', glow: '#8b5cf6' },
  // R → ruby + amber
  { from: '#f43f5e', mid: '#f97316', to: '#facc15', glow: '#f97316' },
  // J → ocean + lime
  { from: '#0891b2', mid: '#22d3ee', to: '#84cc16', glow: '#22d3ee' },
  // P → plum + rose
  { from: '#7c3aed', mid: '#c026d3', to: '#fb7185', glow: '#c026d3' },
  // T → turquoise + indigo
  { from: '#2dd4bf', mid: '#0ea5e9', to: '#6366f1', glow: '#0ea5e9' },
  // L → sunset peach + violet
  { from: '#fda4af', mid: '#f472b6', to: '#8b5cf6', glow: '#f472b6' },
  // N → neon mint + sky
  { from: '#34d399', mid: '#22d3ee', to: '#a78bfa', glow: '#34d399' },
  // X → graphite + electric blue
  { from: '#475569', mid: '#3b82f6', to: '#22d3ee', glow: '#3b82f6' },
]

/**
 * Pick a stable palette entry for a peer.
 * Uses both name and color as inputs so collisions between two peers with
 * the same first letter still resolve to distinct gradients.
 */
export function peerGradient(name, color) {
  const seed = `${name || ''}|${color || ''}`
  if (!seed.trim()) return PALETTE[0]
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0
  }
  return PALETTE[h % PALETTE.length]
}

export function gradientCss(g) {
  return `linear-gradient(135deg, ${g.from} 0%, ${g.mid} 50%, ${g.to} 100%)`
}

export function gradientCssRadial(g) {
  return `radial-gradient(120% 100% at 30% 20%, ${g.from} 0%, ${g.mid} 45%, ${g.to} 100%)`
}
