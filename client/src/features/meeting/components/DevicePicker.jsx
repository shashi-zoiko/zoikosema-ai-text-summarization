import { useEffect, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { X } from 'lucide-react'

const KINDS = [
  { kind: 'audioinput', label: 'Microphone' },
  { kind: 'videoinput', label: 'Camera' },
  { kind: 'audiooutput', label: 'Speaker' },
]
const STORAGE_KEY = 'zoiko_devices_v1'

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
}
function savePref(kind, deviceId) {
  const prev = loadPrefs()
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prev, [kind]: deviceId }))
}

export default function DevicePicker({ onClose }) {
  const room = useRoomContext()
  const [devices, setDevices] = useState([])
  const [active, setActive] = useState({}) // kind -> deviceId

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        // Trigger a permission request so labels resolve, then enumerate.
        // If permission is already granted, this is a no-op stream we close
        // immediately.
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
        probe.getTracks().forEach((t) => t.stop())
      } catch { /* user may have denied; we still try enumerate */ }
      const list = await navigator.mediaDevices.enumerateDevices()
      if (cancelled) return
      setDevices(list)
      // Seed `active` from room (current selection) layered with persisted prefs.
      const stored = loadPrefs()
      const seed = { ...stored }
      try {
        const pubs = Array.from(room.localParticipant.trackPublications.values())
        for (const p of pubs) {
          const k = p.track?.kind
          const id = p.track?.mediaStreamTrack?.getSettings()?.deviceId
          if (k === 'audio') seed.audioinput = id
          if (k === 'video') seed.videoinput = id
        }
      } catch { /* fine */ }
      setActive(seed)
    }
    load()
    return () => { cancelled = true }
  }, [room])

  const choose = async (kind, deviceId) => {
    setActive((a) => ({ ...a, [kind]: deviceId }))
    savePref(kind, deviceId)
    try {
      if (kind === 'audioinput') await room.switchActiveDevice('audioinput', deviceId)
      else if (kind === 'videoinput') await room.switchActiveDevice('videoinput', deviceId)
      else if (kind === 'audiooutput') await room.switchActiveDevice('audiooutput', deviceId)
    } catch (e) {
      console.error('switchActiveDevice failed', e)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 grid place-items-center z-40" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-105 max-w-[90vw] bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-100 shadow-xl"
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-semibold">Devices</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100">
            <X size={18} />
          </button>
        </header>
        <div className="p-4 space-y-4">
          {KINDS.map(({ kind, label }) => {
            const opts = devices.filter((d) => d.kind === kind)
            return (
              <div key={kind}>
                <label className="block text-xs text-zinc-400 mb-1">{label}</label>
                <select
                  className="w-full bg-zinc-800 text-sm rounded px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                  value={active[kind] || ''}
                  onChange={(e) => choose(kind, e.target.value)}
                >
                  {opts.length === 0 && <option value="">No devices</option>}
                  {opts.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `${label} ${d.deviceId.slice(0, 6)}`}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
