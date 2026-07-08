/**
 * Background presets for the in-call virtual background.
 *
 * Two kinds of effect, both applied locally (per participant — unlike the
 * meeting-wide theme):
 *   - blur:  { type: 'blur', radius }       blur whatever is behind the person
 *   - image: { type: 'image', src }         replace the background with a scene
 *
 * The image presets are generated, license-clean SVG ROOM scenes (office,
 * living room, meeting room, study, café…) rather than stock photos. They're
 * rendered with a soft depth-of-field blur and warm lighting so they read like
 * a real, slightly-out-of-focus room behind you — exactly the look Google
 * Meet / Teams ship — while staying razor sharp at any resolution, adding zero
 * binary weight, and dodging photo licensing. Users who want a specific real
 * photo can still upload their own.
 */

// Wrap an SVG body (its own <defs> + shapes) into a 1280×720 data URI, with a
// shared soft-focus filter (#dof) and a vignette overlay every room reuses.
function toScene(body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
    <defs>
      <filter id="dof" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="5"/></filter>
      <filter id="dofSoft" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="2.2"/></filter>
      <radialGradient id="vig" cx="50%" cy="46%" r="72%">
        <stop offset="58%" stop-color="#000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0.26"/>
      </radialGradient>
      <radialGradient id="bloom" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#fff" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    ${body}
    <rect width="1280" height="720" fill="url(#vig)"/>
  </svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

// A potted plant silhouette (soft) — a recurring prop. Returns an SVG group.
function plant(x, y, s = 1, leaf = '#3f7d52') {
  return `<g transform="translate(${x} ${y}) scale(${s})" filter="url(#dofSoft)">
    <path d="M-32 120 L32 120 L24 200 L-24 200 Z" fill="#b07a47"/>
    <ellipse cx="0" cy="118" rx="34" ry="10" fill="#915f33"/>
    <path d="M0 120 C-70 60 -78 -30 -34 -78 C-20 -20 -8 30 0 120 Z" fill="${leaf}"/>
    <path d="M0 120 C70 60 78 -30 34 -78 C20 -20 8 30 0 120 Z" fill="${leaf}"/>
    <path d="M0 120 C-30 40 -22 -60 6 -110 C14 -40 8 40 0 120 Z" fill="${leaf}" opacity="0.92"/>
    <path d="M0 120 C30 50 40 -40 18 -96 C8 -30 6 50 0 120 Z" fill="${leaf}" opacity="0.85"/>
  </g>`
}

// ── Office ──────────────────────────────────────────────────────────────
const OFFICE = toScene(`
  <defs>
    <linearGradient id="ow" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#cfd8e3"/><stop offset="100%" stop-color="#b4c0cf"/></linearGradient>
    <linearGradient id="ofl" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#c8a983"/><stop offset="100%" stop-color="#a3825e"/></linearGradient>
    <linearGradient id="osky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#dbeeff"/><stop offset="100%" stop-color="#aacef0"/></linearGradient>
  </defs>
  <rect width="1280" height="500" fill="url(#ow)"/>
  <rect y="500" width="1280" height="220" fill="url(#ofl)"/>
  <g filter="url(#dof)">
    <!-- window with daylight -->
    <rect x="760" y="70" width="430" height="320" rx="6" fill="url(#osky)"/>
    <rect x="760" y="70" width="430" height="320" rx="6" fill="none" stroke="#8b96a4" stroke-width="10"/>
    <line x1="975" y1="70" x2="975" y2="390" stroke="#8b96a4" stroke-width="8"/>
    <line x1="760" y1="230" x2="1190" y2="230" stroke="#8b96a4" stroke-width="8"/>
    <ellipse cx="900" cy="180" rx="240" ry="160" fill="url(#bloom)"/>
    <!-- bookshelf left -->
    <rect x="70" y="150" width="230" height="350" rx="6" fill="#6f5440"/>
    <rect x="84" y="170" width="202" height="96" fill="#86664e"/>
    <rect x="84" y="280" width="202" height="96" fill="#86664e"/>
    <rect x="84" y="390" width="202" height="96" fill="#86664e"/>
    ${[0,1,2].map(r=>[0,1,2,3,4,5].map(i=>`<rect x="${92+i*32}" y="${174+r*110}" width="24" height="${78-(i%3)*8}" y2="0" fill="${['#c0563f','#3f6f8e','#d9a441','#5a7d52','#9c6b9e','#cf8a4f'][i]}"/>`).join('')).join('')}
  </g>
  <g filter="url(#dofSoft)">
    <!-- desk + monitor -->
    <rect x="430" y="430" width="430" height="40" rx="6" fill="#7a5b41"/>
    <rect x="600" y="300" width="170" height="120" rx="8" fill="#23292f"/>
    <rect x="612" y="312" width="146" height="96" rx="4" fill="#3a4754"/>
    <rect x="672" y="420" width="26" height="20" fill="#23292f"/>
  </g>
  ${plant(150, 360, 0.95, '#4a7d57')}
`)

// ── Living room ─────────────────────────────────────────────────────────
const LIVING = toScene(`
  <defs>
    <linearGradient id="lw" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#efe2d2"/><stop offset="100%" stop-color="#e3d0ba"/></linearGradient>
    <linearGradient id="lfl" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#bb9468"/><stop offset="100%" stop-color="#9c774d"/></linearGradient>
  </defs>
  <rect width="1280" height="490" fill="url(#lw)"/>
  <rect y="490" width="1280" height="230" fill="url(#lfl)"/>
  <g filter="url(#dof)">
    <!-- framed art -->
    <rect x="250" y="120" width="170" height="130" rx="4" fill="#fbf6ee" stroke="#9c7d5a" stroke-width="10"/>
    <rect x="268" y="138" width="134" height="94" fill="#a7c7c2"/>
    <path d="M268 232 L320 170 L360 210 L402 160 L402 232 Z" fill="#6f9b8e"/>
    <rect x="470" y="150" width="120" height="100" rx="4" fill="#fbf6ee" stroke="#9c7d5a" stroke-width="9"/>
    <!-- window right with warm light -->
    <rect x="900" y="120" width="300" height="270" rx="6" fill="#fbeccf"/>
    <rect x="900" y="120" width="300" height="270" rx="6" fill="none" stroke="#b89a72" stroke-width="10"/>
    <line x1="1050" y1="120" x2="1050" y2="390" stroke="#b89a72" stroke-width="8"/>
    <ellipse cx="1040" cy="230" rx="200" ry="150" fill="url(#bloom)"/>
    <!-- floor lamp -->
    <rect x="820" y="300" width="10" height="210" fill="#5e5043"/>
    <path d="M790 250 L860 250 L848 320 L802 320 Z" fill="#f0d9a8"/>
  </g>
  <g filter="url(#dofSoft)">
    <!-- sofa -->
    <rect x="360" y="470" width="540" height="180" rx="34" fill="#8d6b8f"/>
    <rect x="372" y="450" width="160" height="150" rx="30" fill="#9a789c"/>
    <rect x="560" y="450" width="160" height="150" rx="30" fill="#9a789c"/>
    <rect x="730" y="450" width="160" height="150" rx="30" fill="#9a789c"/>
    <rect x="430" y="470" width="120" height="90" rx="18" fill="#caa0c2"/>
    <rect x="610" y="470" width="120" height="90" rx="18" fill="#caa0c2"/>
    <!-- coffee table -->
    <ellipse cx="630" cy="690" rx="170" ry="30" fill="#7a5b41"/>
  </g>
  ${plant(1130, 430, 1.05, '#3f7d52')}
`)

// ── Meeting room ──────────────────────────────────────────────────────────
const MEETING = toScene(`
  <defs>
    <linearGradient id="mw" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#d7dee6"/><stop offset="100%" stop-color="#bcc6d1"/></linearGradient>
    <linearGradient id="mfl" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#9aa3ad"/><stop offset="100%" stop-color="#7c858f"/></linearGradient>
  </defs>
  <rect width="1280" height="470" fill="url(#mw)"/>
  <rect y="470" width="1280" height="250" fill="url(#mfl)"/>
  <g filter="url(#dof)">
    <!-- window wall with blinds -->
    <rect x="40" y="80" width="520" height="320" rx="6" fill="#cfe6fb"/>
    ${Array.from({length:11}).map((_,i)=>`<rect x="40" y="${88+i*29}" width="520" height="13" fill="#aeccea" opacity="0.7"/>`).join('')}
    <rect x="40" y="80" width="520" height="320" rx="6" fill="none" stroke="#8893a0" stroke-width="10"/>
    <!-- wall screen -->
    <rect x="700" y="110" width="430" height="250" rx="8" fill="#1f262d"/>
    <rect x="716" y="126" width="398" height="218" rx="4" fill="#2c79c4"/>
    <ellipse cx="915" cy="200" rx="180" ry="90" fill="url(#bloom)" opacity="0.5"/>
  </g>
  <g filter="url(#dofSoft)">
    <!-- conference table -->
    <ellipse cx="640" cy="640" rx="500" ry="110" fill="#6f5440"/>
    <ellipse cx="640" cy="624" rx="500" ry="110" fill="#8a6a4f"/>
    <!-- chairs -->
    ${[-380,-200,0,200,380].map(dx=>`<g transform="translate(${640+dx} 560)"><rect x="-38" y="-70" width="76" height="86" rx="16" fill="#3a4350"/><rect x="-34" y="6" width="68" height="40" rx="10" fill="#48525f"/></g>`).join('')}
  </g>
`)

// ── Study / bookshelf ──────────────────────────────────────────────────────
const STUDY_PALETTE = ['#9c4a3a', '#3f6f8e', '#caa23f', '#5a7d52', '#7d5a86', '#b5703f', '#46708a', '#a8543f', '#cda94f', '#6b8f5a']
const STUDY = toScene(`
  <defs>
    <linearGradient id="sw" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3a2c22"/><stop offset="100%" stop-color="#2a1f18"/></linearGradient>
    <radialGradient id="lamp" cx="50%" cy="40%" r="60%"><stop offset="0%" stop-color="#ffdb99" stop-opacity="0.3"/><stop offset="100%" stop-color="#ffdb99" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#sw)"/>
  <g filter="url(#dof)">
    <rect x="80" y="60" width="1120" height="600" rx="8" fill="#5a4231"/>
    ${Array.from({ length: 4 }).map((_, r) => {
      const board = 196 + r * 150   // top of the shelf board the books sit on
      const back = `<rect x="100" y="${70 + r * 150}" width="1080" height="126" fill="#6b4f3a"/><rect x="100" y="${board}" width="1080" height="12" fill="#3c2c20"/>`
      const books = Array.from({ length: 34 }).map((_, i) => {
        const col = STUDY_PALETTE[(i * 3 + r) % STUDY_PALETTE.length]
        const h = 96 - ((i * 7 + r * 3) % 30)
        const w = 18 + ((i * 5) % 10)
        return `<rect x="${112 + i * 31}" y="${board - h}" width="${w}" height="${h}" fill="${col}"/>`
      }).join('')
      return back + books
    }).join('')}
  </g>
  <ellipse cx="240" cy="170" rx="300" ry="220" fill="url(#lamp)"/>
  ${plant(180, 470, 1.1, '#4a7d57')}
`)

// ── Café / lounge ───────────────────────────────────────────────────────
const CAFE = toScene(`
  <defs>
    <linearGradient id="cfl" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7a5638"/><stop offset="100%" stop-color="#5e3f28"/></linearGradient>
    <radialGradient id="bulb" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#ffd98a" stop-opacity="0.95"/><stop offset="100%" stop-color="#ffd98a" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1280" height="520" fill="#5b463a"/>
  <rect y="520" width="1280" height="200" fill="url(#cfl)"/>
  <g filter="url(#dof)">
    <!-- brick wall -->
    ${Array.from({length:7}).map((_,r)=>Array.from({length:13}).map((_,i)=>`<rect x="${(r%2?-48:0)+i*104}" y="${20+r*64}" width="96" height="52" rx="4" fill="#7d5a44" opacity="0.65"/>`).join('')).join('')}
    <!-- chalkboard -->
    <rect x="120" y="140" width="280" height="200" rx="8" fill="#26302b" stroke="#8a6b4c" stroke-width="12"/>
    <rect x="160" y="186" width="180" height="10" rx="5" fill="#cfd8c8" opacity="0.7"/>
    <rect x="160" y="216" width="200" height="8" rx="4" fill="#cfd8c8" opacity="0.5"/>
    <rect x="160" y="244" width="140" height="8" rx="4" fill="#cfd8c8" opacity="0.5"/>
  </g>
  <g filter="url(#dofSoft)">
    <!-- hanging bulbs -->
    ${[520,760,1000].map((x,i)=>`<line x1="${x}" y1="0" x2="${x}" y2="${120+i%2*30}" stroke="#2a2018" stroke-width="4"/><ellipse cx="${x}" cy="${150+i%2*30}" rx="60" ry="60" fill="url(#bulb)"/><circle cx="${x}" cy="${140+i%2*30}" r="14" fill="#ffe6a3"/>`).join('')}
    <!-- counter -->
    <rect x="0" y="560" width="1280" height="40" fill="#6f4e34"/>
  </g>
  ${plant(1120, 470, 1.0, '#4a7d57')}
`)

// ── Warm studio (soft, minimal) ────────────────────────────────────────────
const WARM = toScene(`
  <defs>
    <linearGradient id="ww" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#f2e4d0"/><stop offset="55%" stop-color="#e7cfae"/><stop offset="100%" stop-color="#d9b98c"/></linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#ww)"/>
  <g filter="url(#dof)">
    <ellipse cx="980" cy="180" rx="300" ry="220" fill="url(#bloom)"/>
    <rect x="120" y="120" width="150" height="200" rx="6" fill="#fbf4e8" stroke="#b89a72" stroke-width="10"/>
    <path d="M138 320 L188 250 L226 296 L252 264 L252 320 Z" fill="#c39a6a"/>
  </g>
  ${plant(1090, 430, 1.15, '#5a8f63')}
  ${plant(170, 470, 0.8, '#4a7d57')}
`)

// ── Zoiko Group branded background ──────────────────────────────────────────
// Recreates the ZoikoGroup logo (white rounded card + "ZG" monogram) on the
// brand navy, with a large faint watermark so the brand still reads when a
// person sits centre-frame.
const ZOIKO = toScene(`
  <defs>
    <linearGradient id="zgbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1d4f6a"/><stop offset="100%" stop-color="#143a50"/></linearGradient>
    <linearGradient id="zgink" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#3f93a8"/><stop offset="52%" stop-color="#21607d"/><stop offset="100%" stop-color="#173f56"/></linearGradient>
    <filter id="zgsh" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#08222f" flood-opacity="0.5"/></filter>
  </defs>
  <rect width="1280" height="720" fill="url(#zgbg)"/>
  <text x="640" y="500" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="640" fill="#ffffff" opacity="0.05">ZG</text>
  <g filter="url(#zgsh)">
    <rect x="488" y="158" width="304" height="304" rx="64" fill="#ffffff"/>
  </g>
  <text x="642" y="372" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="176" letter-spacing="-8" fill="url(#zgink)">ZG</text>
`)

// ── Public preset lists ─────────────────────────────────────────────────────

// Blur effects. `radius` is the gaussian blur applied to the background.
export const BLUR_PRESETS = [
  { id: 'blur-light', name: 'Slight blur', type: 'blur', radius: 8 },
  { id: 'blur', name: 'Blur', type: 'blur', radius: 18 },
]

export const IMAGE_PRESETS = [
  { id: 'zoiko', name: 'Zoiko Group', type: 'image', src: ZOIKO },
  { id: 'office', name: 'Office', type: 'image', src: OFFICE },
  { id: 'meeting', name: 'Meeting room', type: 'image', src: MEETING },
  { id: 'living', name: 'Living room', type: 'image', src: LIVING },
  { id: 'study', name: 'Study', type: 'image', src: STUDY },
  { id: 'cafe', name: 'Café', type: 'image', src: CAFE },
  { id: 'warm', name: 'Warm studio', type: 'image', src: WARM },
]

// Colour-grade face/camera filters (Google-Meet "Filters" tab). Unlike the
// blur/image backgrounds these need NO segmentation — the engine just draws the
// raw frame through the given CSS `filter`, so they're cheap enough to run at
// any participant count (the cost is per-client and constant, so we don't gate
// them on meeting size). `css` is any value valid for CanvasRenderingContext2D
// .filter. ponytail: warm/cool are CSS-filter approximations of a colour tint —
// swap for a tint-overlay pass if a stronger grade is ever needed.
export const FILTER_PRESETS = [
  { id: 'filter-soft', name: 'Soft focus', type: 'filter', css: 'blur(1px) brightness(1.06) contrast(1.02)' },
  { id: 'filter-warm', name: 'Warm', type: 'filter', css: 'sepia(0.35) saturate(1.4) brightness(1.03)' },
  { id: 'filter-cool', name: 'Cool', type: 'filter', css: 'saturate(0.85) brightness(1.05) contrast(1.05)' },
  { id: 'filter-bw', name: 'Black & white', type: 'filter', css: 'grayscale(1) contrast(1.05)' },
  { id: 'filter-bright', name: 'Brighten', type: 'filter', css: 'brightness(1.2) contrast(1.03)' },
]

export const NONE_EFFECT = { id: 'none', type: 'none', name: 'No effect' }

// Look up a preset by id across all built-in lists (not uploads).
const BY_ID = Object.fromEntries(
  [NONE_EFFECT, ...BLUR_PRESETS, ...IMAGE_PRESETS, ...FILTER_PRESETS].map((p) => [p.id, p])
)

export function getPreset(id) {
  return BY_ID[id] || NONE_EFFECT
}
