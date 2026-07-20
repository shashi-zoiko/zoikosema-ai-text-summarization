import { useCallback, useRef, useState } from 'react'
import { useRoomContext } from '@livekit/components-react'
import Modal from '../../../components/ui/Modal.jsx'
import { useRoomStore } from '../state/roomStore.js'
import { createStatsCollector } from './statsCollector.js'
import { collectConnectionStats } from './connectionStats.js'
import { useDisposable } from './useDisposable.js'
import { fmtBitrate, fmtFps, fmtMs, fmtPct, fmtResolution } from './diagnosticsFormat.js'

/**
 * Connection statistics (ZS-MTG-IMP-03 §10.1). Completely lazy: the single
 * bounded collector starts on mount (dialog open) and is disposed on unmount
 * (close) — no polling, timers, or subscriptions exist while closed. Read-only:
 * never touches media/subscriptions/participants. Presented via shared Modal.
 *
 * Reuses existing sources: LiveKit per-track getRTCStatsReport + connectionQuality,
 * and the already-collected `cameraStats` (from CameraQualityProbe) for delivered
 * resolution/fps — no second monitoring pipeline.
 */

const QUALITY_LABEL = { excellent: 'Excellent', good: 'Good', poor: 'Poor', lost: 'Lost', unknown: 'Unknown' }
const STATE_LABEL = { connected: 'Connected', reconnecting: 'Reconnecting', connecting: 'Connecting', disconnected: 'Disconnected' }

export default function ConnectionStatsDialog({ onClose }) {
  const room = useRoomContext()
  const cameraStats = useRoomStore((s) => s.cameraStats)
  const [sample, setSample] = useState(null)
  const prevRef = useRef({})

  useDisposable(useCallback(() => {
    const collector = createStatsCollector({
      collect: () => collectConnectionStats(room, prevRef),
      onSample: setSample,
    })
    collector.start()
    return () => collector.stop() // dispose the interval + abort in-flight collect on close
  }, [room]))

  // Prefer the already-measured delivered format for resolution/fps.
  const width = cameraStats?.width ?? sample?.video.width
  const height = cameraStats?.height ?? sample?.video.height
  const fps = cameraStats?.frameRate ?? sample?.video.fps

  return (
    <Modal open onClose={onClose} title="Connection statistics" description="Your live network and media quality." size="md">
      <div className="space-y-4">
        <Section title="Connection">
          <Row label="Status" value={STATE_LABEL[sample?.state] || '—'} />
          <Row label="Quality" value={QUALITY_LABEL[sample?.quality] || '—'} />
          <Row label="Transport" value={sample?.transport || '—'} />
        </Section>
        <Section title="Video (sending)">
          <Row label="Resolution" value={fmtResolution(width, height)} />
          <Row label="Frame rate" value={fmtFps(fps)} />
          <Row label="Bitrate" value={fmtBitrate(sample?.video.bitrate)} />
          <Row label="Round-trip time" value={fmtMs(sample?.video.rtt)} />
          <Row label="Jitter" value={fmtMs(sample?.video.jitter)} />
          <Row label="Packet loss" value={fmtPct(sample?.video.packetLoss)} />
          {sample?.video.limitation && <Row label="Limited by" value={sample.video.limitation} />}
        </Section>
        <Section title="Audio (sending)">
          <Row label="Bitrate" value={fmtBitrate(sample?.audio.bitrate)} />
          <Row label="Packet loss" value={fmtPct(sample?.audio.packetLoss)} />
        </Section>
      </div>
    </Modal>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--c-fg-muted)]">{title}</h3>
      <div className="divide-y divide-[var(--c-line)] rounded-lg border border-[var(--c-line)]">{children}</div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2 text-[13px]">
      <span className="text-[var(--c-fg-muted)]">{label}</span>
      <span className="font-medium tabular-nums text-[var(--c-fg)]">{value}</span>
    </div>
  )
}
