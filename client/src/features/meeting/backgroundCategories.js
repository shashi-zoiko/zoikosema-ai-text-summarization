/**
 * Background category taxonomy for the virtual-background gallery.
 *
 * The categories are defined once here (id + display label) so components never
 * hard-code category names — the sidebar chips and grouped sections are all
 * generated from this list. Each image preset in backgroundPresets.js carries a
 * `category` id that must match one of these.
 *
 * Empty categories are intentionally NOT rendered (see {@link groupByCategory}):
 * the gallery groups only what actually has backgrounds, so the counts users
 * see are always real. Add a scene to a category and it appears on its own.
 */
export const BACKGROUND_CATEGORIES = [
  { id: 'organization', label: 'Organization' },
  { id: 'zoiko-signature', label: 'Zoiko Signature' },
  { id: 'executive-professional', label: 'Executive & Professional' },
  { id: 'modern-workspace', label: 'Modern Workspace' },
  { id: 'home-office', label: 'Home Office' },
  { id: 'nature-wellbeing', label: 'Nature & Well-being' },
  { id: 'global-places', label: 'Global Places' },
]

const LABEL_BY_ID = Object.fromEntries(BACKGROUND_CATEGORIES.map((c) => [c.id, c.label]))

/** Human label for a category id (falls back to a generic bucket). */
export function categoryLabel(id) {
  return LABEL_BY_ID[id] || 'Other'
}

/**
 * True when a preset matches a free-text query — by name, category label, or
 * tag. Shared by every background gallery surface so search behaves identically
 * in the lobby and in-call. `q` may be raw (trimmed/lowercased here).
 */
export function matchesQuery(preset, q) {
  const query = (q || '').trim().toLowerCase()
  if (!query) return true
  if (preset.name?.toLowerCase().includes(query)) return true
  if (preset.category && categoryLabel(preset.category).toLowerCase().includes(query)) return true
  if (Array.isArray(preset.tags) && preset.tags.some((t) => t.toLowerCase().includes(query))) return true
  return false
}

/**
 * Group image presets by category, preserving the canonical category order and
 * dropping categories that have no backgrounds. Returns
 * `[{ id, label, items }]` — ready to map straight into sections.
 */
export function groupByCategory(presets) {
  const buckets = new Map()
  for (const p of presets) {
    const cat = p.category || 'organization'
    if (!buckets.has(cat)) buckets.set(cat, [])
    buckets.get(cat).push(p)
  }
  return BACKGROUND_CATEGORIES
    .filter((c) => buckets.has(c.id))
    .map((c) => ({ id: c.id, label: c.label, items: buckets.get(c.id) }))
}
