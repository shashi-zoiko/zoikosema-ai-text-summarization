import { Fragment } from 'react'
import { emojiSrc, hasEmojiImage } from './emojiLookup'

/**
 * Apple emoji pack image components. See ./emoji.js for the lookup + why we
 * render images instead of the native Unicode glyph.
 */

/**
 * Render one emoji glyph as the pack image. Falls back to the raw glyph (native
 * font) when the pack has no matching art, so nothing ever disappears.
 *
 * `size` is any CSS length (default 1.2em so it tracks surrounding text).
 */
export default function Emoji({ char, size = '1.2em', className = '', alt, title }) {
  const src = emojiSrc(char)
  if (!src) {
    // Native-font fallback. Size it to match the image branch so a missing
    // glyph doesn't shrink to the inherited text size.
    return (
      <span
        className={className}
        role="img"
        aria-label={alt ?? char}
        style={{ fontSize: size, lineHeight: 1 }}
      >
        {char}
      </span>
    )
  }
  return (
    <img
      src={src}
      alt={alt ?? char}
      title={title}
      draggable={false}
      loading="lazy"
      className={`zk-emoji ${className}`}
      style={{ width: size, height: size }}
    />
  )
}

/**
 * Render arbitrary text with any emoji glyphs swapped for pack images, leaving
 * the rest of the text untouched. Used for chat message bodies. Splits on
 * grapheme clusters so multi-codepoint emoji (flags, ZWJ sequences) stay whole.
 */
export function EmojiText({ text, className = '', emojiSize = '1.25em' }) {
  if (!text) return null

  // Intl.Segmenter is available in every browser/runtime this app targets.
  // Guard anyway: if absent, render the text verbatim (native emoji).
  if (typeof Intl === 'undefined' || !Intl.Segmenter) {
    return <span className={className}>{text}</span>
  }

  const parts = []
  let buf = ''
  const flush = () => { if (buf) { parts.push(buf); buf = '' } }

  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  for (const { segment } of seg.segment(text)) {
    if (hasEmojiImage(segment)) {
      flush()
      parts.push(<Emoji key={parts.length} char={segment} size={emojiSize} />)
    } else {
      buf += segment
    }
  }
  flush()

  return (
    <span className={className}>
      {parts.map((p, i) => (typeof p === 'string' ? <Fragment key={i}>{p}</Fragment> : p))}
    </span>
  )
}
