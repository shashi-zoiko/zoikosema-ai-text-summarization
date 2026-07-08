import { useEffect, useRef, useState } from 'react'
import { useMediaDeviceSelect } from '@livekit/components-react'
import {
  Accessibility, Ban, Bell, BellOff, Check, ImagePlus, Loader2, Mic, Palette, Play,
  Sparkles, Video, Volume2, VolumeX,
} from 'lucide-react'
import DrawerShell from './DrawerShell.jsx'
import { BLUR_PRESETS, IMAGE_PRESETS, FILTER_PRESETS } from '../backgroundPresets.js'
import { useNotifications } from '../notify/NotificationProvider.jsx'

const TABS = [
  { id: 'audio', label: 'Audio', icon: Mic },
  { id: 'video', label: 'Video', icon: Video },
  { id: 'backgrounds', label: 'Backgrounds', icon: Sparkles },
  { id: 'filters', label: 'Filters', icon: Palette },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'accessibility', label: 'Accessibility', icon: Accessibility },
]

/**
 * Meeting settings drawer. Tabs:
 *   Audio          — microphone + speaker selection (live, via LiveKit)
 *   Video          — camera selection (live)
 *   Backgrounds    — local virtual-background effect (blur / image / upload)
 *   Notifications  — join & leave alerts (persisted, gates the room toasts)
 *   Accessibility  — reduce motion (persisted, applied to the document)
 */
export default function SettingsDrawer({
  onClose,
  tab: tabProp, onTab,
  bgEffectId, onSelectBg, bgLoading, bgSupported, uploads = [], onUpload, cameraOn,
}) {
  // Controlled when a parent passes `tab`/`onTab` (e.g. "Backgrounds" in the
  // dock's More menu deep-links straight to that tab); otherwise self-managed.
  const [tabState, setTabState] = useState(tabProp || 'audio')
  const tab = tabProp ?? tabState
  const setTab = onTab ?? setTabState

  const subheader = (
    <div className="zk-filmstrip flex shrink-0 gap-1 overflow-x-auto border-b border-[#263244] px-2 py-2">
      {TABS.map((t) => {
        const Icon = t.icon
        const active = tab === t.id
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={active}
            className={
              'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ' +
              (active
                ? 'bg-[#10B981]/15 text-[#34D399]'
                : 'text-[#94A3B8] hover:bg-white/[0.06] hover:text-white')
            }
          >
            <Icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        )
      })}
    </div>
  )

  return (
    <DrawerShell title="Settings" onClose={onClose} subheader={subheader}>
      <div className="px-4 py-4">
        {tab === 'audio' && (
          <>
            <DeviceSection kind="audioinput" title="Microphone" icon={<Mic className="h-4 w-4" />} />
            <div className="my-4 h-px bg-[#263244]" />
            <DeviceSection kind="audiooutput" title="Speaker" icon={<Volume2 className="h-4 w-4" />} />
          </>
        )}
        {tab === 'video' && (
          <DeviceSection kind="videoinput" title="Camera" icon={<Video className="h-4 w-4" />} />
        )}
        {tab === 'backgrounds' && (
          <BackgroundSection
            bgEffectId={bgEffectId}
            onSelectBg={onSelectBg}
            bgLoading={bgLoading}
            bgSupported={bgSupported}
            uploads={uploads}
            onUpload={onUpload}
            cameraOn={cameraOn}
          />
        )}
        {tab === 'filters' && (
          <FilterSection
            bgEffectId={bgEffectId}
            onSelectBg={onSelectBg}
            bgLoading={bgLoading}
            bgSupported={bgSupported}
            cameraOn={cameraOn}
          />
        )}
        {tab === 'notifications' && <NotificationsSection />}
        {tab === 'accessibility' && <AccessibilitySection />}
      </div>
    </DrawerShell>
  )
}

/* ── Device selection (live via LiveKit) ─────────────────────────────────── */

function DeviceSection({ kind, title, icon }) {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind })
  return (
    <div>
      <SectionHead icon={icon} title={title} />
      <div className="space-y-1.5">
        {devices.length === 0 && (
          <p className="rounded-lg bg-[#0B1220] px-3 py-2.5 text-[12.5px] text-[#94A3B8]">
            No {title.toLowerCase()} detected.
          </p>
        )}
        {devices.map((d) => {
          const active = d.deviceId === activeDeviceId
          return (
            <button
              key={d.deviceId}
              type="button"
              onClick={() => { if (!active) setActiveMediaDevice(d.deviceId).catch(() => {}) }}
              aria-pressed={active}
              className={
                'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[13px] transition ' +
                (active
                  ? 'border-[#10B981]/40 bg-[#10B981]/12 text-white'
                  : 'border-[#263244] bg-[#0B1220] text-white/90 hover:bg-[#1E293B]')
              }
            >
              <span
                className={
                  'grid h-4 w-4 shrink-0 place-items-center rounded-full border ' +
                  (active ? 'border-[#10B981] bg-[#10B981]' : 'border-[#475569]')
                }
              >
                {active && <Check className="h-2.5 w-2.5 text-[#0B1220]" />}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {d.label || `${title} ${d.deviceId.slice(0, 6)}`}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── Virtual backgrounds (local, per-participant camera effect) ──────────── */

function BackgroundSection({ bgEffectId, onSelectBg, bgLoading, bgSupported, uploads, onUpload, cameraOn }) {
  const fileRef = useRef(null)
  const pickFile = () => fileRef.current?.click()
  const onFile = (e) => {
    const file = e.target.files?.[0]
    if (file && onUpload) onUpload(file)
    e.target.value = ''
  }

  return (
    <div>
      <SectionHead
        icon={<Sparkles className="h-4 w-4" />}
        title="Background"
        hint={
          bgSupported
            ? 'Blur or replace what’s behind you. Only you see the change.'
            : 'Background effects aren’t supported on this device or browser.'
        }
      />

      {!bgSupported ? null : (
        <>
          {!cameraOn && (
            <p className="mb-3 rounded-lg bg-[#F59E0B]/12 px-3 py-2 text-[12px] font-medium text-[#FBBF24]">
              Turn your camera on to preview the effect.
            </p>
          )}
          <div className="grid grid-cols-3 gap-2">
            <BgTile
              selected={bgEffectId === 'none'}
              onClick={() => onSelectBg?.({ id: 'none', type: 'none' })}
              label="None"
              loading={bgLoading && bgEffectId === 'none'}
            >
              <span className="grid h-full w-full place-items-center bg-[#0B1220] text-[#475569]">
                <Ban className="h-5 w-5" />
              </span>
            </BgTile>

            {BLUR_PRESETS.map((p) => (
              <BgTile
                key={p.id}
                selected={bgEffectId === p.id}
                onClick={() => onSelectBg?.(p)}
                label={p.name}
                loading={bgLoading && bgEffectId === p.id}
              >
                <span
                  className="grid h-full w-full place-items-center"
                  style={{ background: 'radial-gradient(120% 120% at 50% 18%, #334155 0%, #1e293b 60%, #0b1220 100%)' }}
                >
                  <span
                    className="rounded-full bg-white/85"
                    style={{ width: 26, height: 26, filter: `blur(${Math.min(p.radius / 4, 4)}px)` }}
                  />
                </span>
              </BgTile>
            ))}

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

            <button
              type="button"
              onClick={pickFile}
              title="Upload a background image"
              className="flex aspect-video flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[#10B981]/40 bg-[#10B981]/[0.06] text-[#34D399] transition hover:bg-[#10B981]/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]/45"
            >
              <ImagePlus className="h-5 w-5" />
              <span className="text-[11px] font-semibold">Upload</span>
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
          </div>
        </>
      )}
    </div>
  )
}

/* ── Camera filters (local, per-participant colour grade — no segmentation) ── */

function FilterSection({ bgEffectId, onSelectBg, bgLoading, bgSupported, cameraOn }) {
  return (
    <div>
      <SectionHead
        icon={<Palette className="h-4 w-4" />}
        title="Filters"
        hint={
          bgSupported
            ? 'Apply a colour tone to your camera. Only you see the change.'
            : 'Camera filters aren’t supported on this device or browser.'
        }
      />

      {!bgSupported ? null : (
        <>
          {!cameraOn && (
            <p className="mb-3 rounded-lg bg-[#F59E0B]/12 px-3 py-2 text-[12px] font-medium text-[#FBBF24]">
              Turn your camera on to preview the filter.
            </p>
          )}
          <div className="grid grid-cols-3 gap-2">
            <BgTile
              selected={bgEffectId === 'none'}
              onClick={() => onSelectBg?.({ id: 'none', type: 'none' })}
              label="None"
              loading={bgLoading && bgEffectId === 'none'}
            >
              <span className="grid h-full w-full place-items-center bg-[#0B1220] text-[#475569]">
                <Ban className="h-5 w-5" />
              </span>
            </BgTile>

            {FILTER_PRESETS.map((p) => (
              <BgTile
                key={p.id}
                selected={bgEffectId === p.id}
                onClick={() => onSelectBg?.(p)}
                label={p.name}
                loading={bgLoading && bgEffectId === p.id}
              >
                <span
                  className="block h-full w-full"
                  style={{ background: 'linear-gradient(135deg,#f59e0b 0%,#10b981 50%,#3b82f6 100%)', filter: p.css }}
                />
              </BgTile>
            ))}
          </div>
        </>
      )}
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
        'relative aspect-video overflow-hidden rounded-xl border transition ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]/45 ' +
        (selected ? 'border-[#10B981] ring-2 ring-[#10B981]' : 'border-[#263244] hover:border-[#475569]')
      }
    >
      {children}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-3 text-left text-[10px] font-medium text-white">
        {label}
      </span>
      {selected && !loading && (
        <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-[#10B981] text-[#0B1220] shadow">
          <Check className="h-2.5 w-2.5" />
        </span>
      )}
      {loading && (
        <span className="absolute inset-0 grid place-items-center bg-black/50 text-white">
          <Loader2 className="h-4 w-4 animate-spin" />
        </span>
      )}
    </button>
  )
}

/* ── Notifications (persisted; gates the room join/leave toasts) ──────────── */

const PREVIEW_SOUNDS = [
  { kind: 'chat', label: 'Chat message' },
  { kind: 'lobby', label: 'Join request' },
  { kind: 'join', label: 'Participant joined' },
  { kind: 'leave', label: 'Participant left' },
  { kind: 'call-end', label: 'Left / meeting ended' },
  { kind: 'hand', label: 'Raised hand' },
  { kind: 'screenshare', label: 'Screen share' },
]

function NotificationsSection() {
  const [joinAlerts, setJoinAlerts] = usePref('zoiko_meet_join_alerts', true)
  const { prefs, setMuted, setVolume, previewSound } = useNotifications()
  const { muted, volume } = prefs

  return (
    <div>
      <SectionHead icon={<Bell className="h-4 w-4" />} title="Notifications" />

      <ToggleRow
        label="Mute notification sounds"
        hint="Silence chat, lobby, join/leave and other meeting sounds. Badges and toasts still appear."
        checked={muted}
        onChange={setMuted}
      />

      {/* Master volume */}
      <div className={'mt-3 rounded-xl border border-[#263244] bg-[#0B1220] px-3.5 py-3 transition ' + (muted ? 'opacity-50' : '')}>
        <div className="mb-2 flex items-center gap-2 text-[13.5px] font-medium text-white">
          {muted ? <VolumeX className="h-4 w-4 text-[#94A3B8]" /> : <Volume2 className="h-4 w-4 text-[#34D399]" />}
          Notification volume
          <span className="ml-auto text-[12px] font-normal text-[#94A3B8]">{Math.round(volume * 100)}%</span>
        </div>
        <input
          type="range"
          min="0" max="1" step="0.05"
          value={volume}
          disabled={muted}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          aria-label="Notification volume"
          className="h-1.5 w-full cursor-pointer accent-[#10B981] disabled:cursor-not-allowed"
        />
      </div>

      {/* Sound preview */}
      <div className="mt-4 mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-[#94A3B8]">
        {muted ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />} Preview sounds
      </div>
      <div className="grid grid-cols-2 gap-2">
        {PREVIEW_SOUNDS.map((s) => (
          <button
            key={s.kind}
            type="button"
            onClick={() => previewSound(s.kind)}
            className="flex items-center gap-2 rounded-xl border border-[#263244] bg-[#0B1220] px-3 py-2.5 text-left text-[12.5px] text-white/90 transition hover:bg-[#1E293B]"
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-[#10B981]/15 text-[#34D399]">
              <Play className="h-3 w-3" />
            </span>
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[#64748B]">
        Previews play at full volume so you can hear them clearly, even while muted.
      </p>

      <div className="my-4 h-px bg-[#263244]" />

      <ToggleRow
        label="Join & leave alerts"
        hint="Show a toast when someone enters or leaves the call."
        checked={joinAlerts}
        onChange={setJoinAlerts}
      />
    </div>
  )
}

/* ── Accessibility (persisted; applied to the document root) ─────────────── */

function AccessibilitySection() {
  const [reduceMotion, setReduceMotion] = usePref('zoiko_meet_reduce_motion', false)
  useEffect(() => {
    if (reduceMotion) document.documentElement.dataset.reduceMotion = '1'
    else delete document.documentElement.dataset.reduceMotion
  }, [reduceMotion])
  return (
    <div>
      <SectionHead icon={<Accessibility className="h-4 w-4" />} title="Accessibility" />
      <ToggleRow
        label="Reduce motion"
        hint="Minimise animations and transitions across the meeting UI."
        checked={reduceMotion}
        onChange={setReduceMotion}
      />
    </div>
  )
}

/* ── Shared primitives ───────────────────────────────────────────────────── */

function SectionHead({ icon, title, hint }) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#10B981]/15 text-[#34D399]">
          {icon}
        </span>
        <h3 className="text-[14px] font-semibold text-white">{title}</h3>
      </div>
      {hint && <p className="text-[12px] leading-relaxed text-[#94A3B8]">{hint}</p>}
    </div>
  )
}

function ToggleRow({ label, hint, checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 rounded-xl border border-[#263244] bg-[#0B1220] px-3.5 py-3 text-left transition hover:bg-[#1E293B]"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-medium text-white">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] leading-snug text-[#94A3B8]">{hint}</span>}
      </span>
      <span
        className={
          'relative h-6 w-11 shrink-0 rounded-full transition-colors ' +
          (checked ? 'bg-[#10B981]' : 'bg-[#334155]')
        }
      >
        <span
          className={
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ' +
            (checked ? 'translate-x-[22px]' : 'translate-x-0.5')
          }
        />
      </span>
    </button>
  )
}

/** localStorage-backed boolean preference. */
function usePref(key, fallback) {
  const [val, setVal] = useState(() => {
    try {
      const v = localStorage.getItem(key)
      return v === null ? fallback : v === '1'
    } catch { return fallback }
  })
  const set = (next) => {
    setVal(next)
    try { localStorage.setItem(key, next ? '1' : '0') } catch { /* private mode */ }
  }
  return [val, set]
}
