import { useRef } from 'react'
import { Ban, Check, ImagePlus, Loader2, Lock, Palette, Sparkles } from 'lucide-react'
import { ROOM_THEMES } from './roomThemes'
import { BLUR_PRESETS, IMAGE_PRESETS } from './backgroundPresets'

/**
 * "Themes & background" panel — lives in the in-call right sidebar.
 *
 * Two independent sections:
 *   1. Background — a LOCAL, per-participant camera effect (blur / image /
 *      upload). Only the person who picks it is affected, like Google Meet.
 *   2. Theme — the meeting-wide ambient look. Host/co-host controlled and
 *      synced to everyone, so non-hosts see it read-only.
 */
export default function ThemePicker({
  // background (local)
  bgEffectId = 'none',
  onSelectBg,
  bgLoading = false,
  bgSupported = true,
  uploads = [],
  onUpload,
  cameraOn = true,
  // theme (meeting-wide)
  themeId,
  onSelectTheme,
  canEditTheme,
}) {
  const fileRef = useRef(null)

  const pickFile = () => fileRef.current?.click()
  const onFile = (e) => {
    const file = e.target.files?.[0]
    if (file && onUpload) onUpload(file)
    e.target.value = '' // allow re-selecting the same file
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      {/* ── Background (local) ──────────────────────────────────────── */}
      <SectionHead
        icon={<Sparkles className="h-4 w-4" />}
        title="Background"
        hint={
          bgSupported
            ? 'Blur or replace what’s behind you. Only you change — others keep their own.'
            : 'Background effects aren’t supported on this device or browser.'
        }
      />

      {bgSupported && (
        <>
          {!cameraOn && (
            <p className="mb-2.5 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] font-medium text-amber-700">
              Turn your camera on to see the effect.
            </p>
          )}
          <div className="grid grid-cols-3 gap-2">
            {/* None */}
            <BgTile
              selected={bgEffectId === 'none'}
              onClick={() => onSelectBg?.({ id: 'none', type: 'none' })}
              label="None"
              loading={bgLoading && bgEffectId === 'none'}
            >
              <span className="grid h-full w-full place-items-center bg-[#eef1f4] text-[#9aa0a6]">
                <Ban className="h-5 w-5" />
              </span>
            </BgTile>

            {/* Blur presets */}
            {BLUR_PRESETS.map((p) => (
              <BgTile
                key={p.id}
                selected={bgEffectId === p.id}
                onClick={() => onSelectBg?.(p)}
                label={p.name}
                loading={bgLoading && bgEffectId === p.id}
              >
                <span
                  className="grid h-full w-full place-items-center text-white/90"
                  style={{
                    background:
                      'radial-gradient(120% 120% at 50% 18%, #5b6473 0%, #2b313d 60%, #161a22 100%)',
                    filter: p.radius > 10 ? 'blur(0.5px)' : 'none',
                  }}
                >
                  <span
                    className="rounded-full bg-white/85"
                    style={{
                      width: 26,
                      height: 26,
                      filter: `blur(${Math.min(p.radius / 4, 4)}px)`,
                    }}
                  />
                </span>
              </BgTile>
            ))}

            {/* Image presets */}
            {IMAGE_PRESETS.map((p) => (
              <BgTile
                key={p.id}
                selected={bgEffectId === p.id}
                onClick={() => onSelectBg?.(p)}
                label={p.name}
                loading={bgLoading && bgEffectId === p.id}
              >
                <img src={p.src} alt="" className="h-full w-full object-cover" />
              </BgTile>
            ))}

            {/* User uploads */}
            {uploads.map((p) => (
              <BgTile
                key={p.id}
                selected={bgEffectId === p.id}
                onClick={() => onSelectBg?.(p)}
                label={p.name || 'Custom'}
                loading={bgLoading && bgEffectId === p.id}
              >
                <img src={p.src} alt="" className="h-full w-full object-cover" />
              </BgTile>
            ))}

            {/* Upload */}
            <button
              type="button"
              onClick={pickFile}
              title="Upload a background image"
              className="zk-press group/up flex aspect-video flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[#0F8A5F]/35 bg-[#0F8A5F]/[0.06] text-[#0c744f] transition hover:bg-[#0F8A5F]/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F8A5F]/45"
            >
              <ImagePlus className="h-5 w-5" />
              <span className="text-[11px] font-semibold">Upload</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onFile}
              className="hidden"
            />
          </div>
        </>
      )}

      {/* ── Theme (meeting-wide) ────────────────────────────────────── */}
      <div className="my-4 h-px bg-black/[0.06]" />
      <SectionHead
        icon={<Palette className="h-4 w-4" />}
        title="Room theme"
        hint={
          canEditTheme
            ? 'Pick an ambient look for the call. Everyone in the meeting sees this.'
            : 'The meeting host sets the room theme for everyone.'
        }
      />

      <div className="grid grid-cols-2 gap-2.5">
        {ROOM_THEMES.map((t) => {
          const selected = t.id === themeId
          return (
            <button
              key={t.id}
              type="button"
              disabled={!canEditTheme}
              onClick={() => canEditTheme && onSelectTheme?.(t.id)}
              aria-pressed={selected}
              title={canEditTheme ? `Apply ${t.name}` : `${t.name} (host controls the theme)`}
              className={
                'group/theme flex items-center gap-2.5 rounded-xl bg-white px-2.5 py-2.5 text-left transition ' +
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F8A5F]/45 ' +
                (canEditTheme ? 'zk-press cursor-pointer hover:bg-[#f7faf8]' : 'cursor-not-allowed opacity-90') +
                (selected ? ' ring-2 ring-[#0F8A5F]' : ' ring-1 ring-black/[0.08]')
              }
            >
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1 ring-black/10"
                style={{ background: t.tileBg }}
              >
                {selected && (
                  <span className="grid h-4 w-4 place-items-center rounded-full bg-[#0F8A5F] text-white shadow">
                    <Check className="h-2.5 w-2.5" />
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#202124]">{t.name}</span>
              {!canEditTheme && selected && <Lock className="h-3 w-3 shrink-0 text-[#9aa0a6]" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SectionHead({ icon, title, hint }) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#0F8A5F]/12 text-[#0F8A5F]">
          {icon}
        </span>
        <h3 className="text-[14px] font-semibold text-[#202124]">{title}</h3>
      </div>
      <p className="text-[12px] leading-relaxed text-[#5f6368]">{hint}</p>
    </div>
  )
}

function BgTile({ selected, onClick, label, loading, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={label}
      className={
        'zk-press relative aspect-video overflow-hidden rounded-xl transition ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F8A5F]/45 ' +
        (selected ? 'ring-2 ring-[#0F8A5F]' : 'ring-1 ring-black/[0.08] hover:ring-black/20')
      }
    >
      {children}
      {/* label scrim */}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/55 to-transparent px-1.5 pb-1 pt-3 text-left text-[10px] font-medium text-white">
        {label}
      </span>
      {selected && !loading && (
        <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-[#0F8A5F] text-white shadow">
          <Check className="h-2.5 w-2.5" />
        </span>
      )}
      {loading && (
        <span className="absolute inset-0 grid place-items-center bg-black/35 text-white">
          <Loader2 className="h-4 w-4 animate-spin" />
        </span>
      )}
    </button>
  )
}
