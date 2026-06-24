import emojiMap from './emojiMap.json'

/**
 * Apple emoji image pack lookup. Native Unicode emoji render with whatever font
 * the OS ships (Segoe on Windows, Noto on Android), so the same glyph looks
 * different per platform — we serve the Apple PNG so everyone sees the same art.
 *
 * Assets are self-hosted under /public/emoji/apple/64 (one PNG per emoji,
 * lazy-loaded). `emojiMap.json` maps a glyph (fully-qualified *and* its
 * non-qualified alias) to the file name.
 */
const BASE = '/emoji/apple/64/'

/** URL for a single emoji glyph, or null when the pack has no image for it. */
export function emojiSrc(char) {
  const file = emojiMap[char]
  return file ? BASE + file : null
}

/** True when the pack has an image for this exact glyph. */
export function hasEmojiImage(char) {
  return !!emojiMap[char]
}
