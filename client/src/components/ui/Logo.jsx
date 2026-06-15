import { cn } from '../../lib/cn'
import iconUrl from '../../assets/zoikosema-icon.jpeg'
import wordmarkUrl from '../../assets/zoikosema-wordmark.svg'

/**
 * ZoikoSema brand mark. Renders either the square icon (default) or the
 * full wordmark + icon lockup when `withWordmark` is set. `size` controls
 * the rendered height in pixels.
 */
export default function Logo({ size = 32, withWordmark = false, className }) {
  const px = typeof size === 'number' ? size : 32

  if (withWordmark) {
    return (
      <img
        src={wordmarkUrl}
        alt="ZoikoSema"
        draggable={false}
        style={{ height: px, width: 'auto' }}
        className={cn('brand-wordmark select-none', className)}
      />
    )
  }

  return (
    <img
      src={iconUrl}
      alt="ZoikoSema"
      draggable={false}
      width={px}
      height={px}
      style={{ width: px, height: px }}
      className={cn('brand-icon select-none rounded-xl', className)}
    />
  )
}
