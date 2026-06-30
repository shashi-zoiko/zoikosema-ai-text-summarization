// Caption speaker colour. Mirrors the per-participant accent logic in
// Stage.jsx (same palette + same identity hash) so a speaker's caption name
// renders in the exact colour as their video tile. Deterministic per identity,
// so the colour is stable for the whole call regardless of join/leave order.
const ACCENTS = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899', '#06B6D4']

export function speakerColor(identity = '') {
  let h = 0
  for (let i = 0; i < identity.length; i++) h = (h * 31 + identity.charCodeAt(i)) | 0
  return ACCENTS[Math.abs(h) % ACCENTS.length]
}
