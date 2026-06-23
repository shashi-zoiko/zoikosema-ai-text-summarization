/**
 * Meeting-room visual themes — the single source of truth for the in-call
 * ambient look, shared by the mesh room (MeetRoom) and (drop-in) the LiveKit
 * room. A theme is meeting-wide: the host/co-host picks one, it syncs to every
 * participant over the signaling socket, and the whole stage re-skins together.
 *
 * Each theme drives, via CSS variables set on the room root + React context:
 *   roomBg  — the ambient stage backdrop behind the tiles
 *   tileBg  — a camera-off tile's background (behind the avatar disc)
 *   accent  — avatar ring / active-speaker glow / selected-state colour
 *   fg/fgDim— foreground text tone for the transparent top bar (over roomBg)
 *   surface — 'dark' | 'light', a coarse hint for any tone-dependent UI
 *
 * Forest is the default — it matches the green brand and replaces the old
 * washed-out neutral wash that read as "dull".
 */

export const DEFAULT_THEME_ID = 'forest'

export const ROOM_THEMES = [
  {
    id: 'forest',
    name: 'Forest',
    surface: 'dark',
    accent: '#34d399',
    fg: '#eaf5ef',
    fgDim: 'rgba(234,245,239,0.72)',
    roomBg:
      'radial-gradient(1500px 880px at 76% -24%, rgba(52,211,153,0.22), transparent 58%),' +
      'radial-gradient(1200px 760px at -14% 118%, rgba(16,185,129,0.16), transparent 58%),' +
      'radial-gradient(700px 520px at 50% 60%, rgba(13,59,43,0.55), transparent 70%),' +
      'linear-gradient(158deg, #0a2e21 0%, #0d3d2c 44%, #06201a 100%)',
    tileBg:
      'radial-gradient(135% 130% at 50% 16%, #1f7d5b 0%, #114532 46%, #0a2a20 100%)',
  },
  {
    id: 'graphite',
    name: 'Graphite',
    surface: 'dark',
    accent: '#2dd4bf',
    fg: '#e8ebf1',
    fgDim: 'rgba(232,235,241,0.68)',
    roomBg:
      'radial-gradient(1400px 820px at 80% -22%, rgba(45,212,191,0.14), transparent 56%),' +
      'radial-gradient(1100px 740px at -10% 120%, rgba(99,102,241,0.10), transparent 56%),' +
      'linear-gradient(160deg, #1a1d26 0%, #101319 52%, #090b10 100%)',
    tileBg:
      'radial-gradient(135% 130% at 50% 18%, #303746 0%, #1a1e28 48%, #0d0f15 100%)',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    surface: 'dark',
    accent: '#a5b4fc',
    fg: '#eaeaff',
    fgDim: 'rgba(234,234,255,0.70)',
    roomBg:
      'radial-gradient(1250px 760px at 50% -20%, rgba(129,140,248,0.26), transparent 58%),' +
      'radial-gradient(880px 580px at 88% 6%, rgba(192,132,252,0.16), transparent 56%),' +
      'radial-gradient(820px 560px at 10% 110%, rgba(56,189,248,0.12), transparent 58%),' +
      'linear-gradient(168deg, #16163f 0%, #100f2c 52%, #07061a 100%)',
    tileBg:
      'radial-gradient(135% 130% at 50% 16%, #3a3a96 0%, #1f1f5a 48%, #0d0d2b 100%)',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    surface: 'dark',
    accent: '#f0abfc',
    fg: '#fdf4ff',
    fgDim: 'rgba(253,244,255,0.82)',
    roomBg:
      'radial-gradient(1250px 760px at 12% -14%, rgba(124,58,237,0.42), transparent 58%),' +
      'radial-gradient(1050px 660px at 92% 2%, rgba(236,72,153,0.32), transparent 56%),' +
      'radial-gradient(1000px 660px at 58% 126%, rgba(37,99,235,0.30), transparent 58%),' +
      'linear-gradient(140deg, #3a1670 0%, #7c1d54 50%, #1d3a8a 100%)',
    tileBg:
      'linear-gradient(140deg, #7c3aed 0%, #c026a8 52%, #2563eb 100%)',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    surface: 'dark',
    accent: '#5eead4',
    fg: '#e6fbf8',
    fgDim: 'rgba(230,251,248,0.72)',
    roomBg:
      'radial-gradient(1400px 840px at 80% -22%, rgba(45,212,191,0.22), transparent 58%),' +
      'radial-gradient(1100px 720px at -10% 120%, rgba(56,189,248,0.18), transparent 58%),' +
      'linear-gradient(160deg, #06323f 0%, #0a4a5c 48%, #052532 100%)',
    tileBg:
      'radial-gradient(135% 130% at 50% 18%, #0e7d8f 0%, #0a4658 48%, #062733 100%)',
  },
  {
    id: 'sand',
    name: 'Sand',
    surface: 'light',
    accent: '#b8862f',
    fg: '#3a2f1d',
    fgDim: 'rgba(58,47,29,0.66)',
    roomBg:
      'radial-gradient(1350px 800px at 80% -18%, rgba(176,137,72,0.18), transparent 56%),' +
      'radial-gradient(1050px 700px at -10% 120%, rgba(214,178,120,0.20), transparent 56%),' +
      'linear-gradient(162deg, #faf3e6 0%, #f0e4cd 52%, #e6d7b9 100%)',
    tileBg:
      'radial-gradient(135% 130% at 50% 18%, #f7eddb 0%, #e9d9bd 50%, #dcc8a4 100%)',
  },
  {
    id: 'light',
    name: 'Light',
    surface: 'light',
    accent: '#2563eb',
    fg: '#1f2937',
    fgDim: 'rgba(31,41,55,0.60)',
    roomBg:
      'radial-gradient(1350px 820px at 80% -20%, rgba(37,99,235,0.10), transparent 56%),' +
      'radial-gradient(1050px 700px at -8% 120%, rgba(99,102,241,0.07), transparent 56%),' +
      'linear-gradient(180deg, #fbfcfe 0%, #eef2f7 100%)',
    tileBg:
      'radial-gradient(135% 130% at 50% 16%, #ffffff 0%, #eef2f7 52%, #e1e8f1 100%)',
  },
]

const THEME_BY_ID = Object.fromEntries(ROOM_THEMES.map((t) => [t.id, t]))

export function getTheme(id) {
  return THEME_BY_ID[id] || THEME_BY_ID[DEFAULT_THEME_ID]
}
