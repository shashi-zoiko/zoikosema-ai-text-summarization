import { useCallback, useRef } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { VideoOff } from 'lucide-react'
import Modal from '../../../components/ui/Modal.jsx'
import { useDisposable } from './useDisposable.js'

/**
 * Camera preview (ZS-MTG-IMP-03 §9.3). Attaches the EXISTING local camera track
 * to a local <video> — no new getUserMedia, no new/duplicate track, no upstream
 * publication. Closing detaches only (never stops the camera), so send state is
 * preserved exactly. If the camera is off, we show guidance rather than starting
 * a new capture (honors "no duplicate media tracks").
 */
export default function CameraPreviewDialog({ onClose }) {
  const { localParticipant } = useLocalParticipant()
  const pub = localParticipant?.getTrackPublication?.(Track.Source.Camera)
  const track = pub && !pub.isMuted ? pub.track : null
  const videoRef = useRef(null)

  useDisposable(useCallback(() => {
    const el = videoRef.current
    if (!track || !el) return undefined
    track.attach(el) // binds the existing MediaStreamTrack — no new capture
    return () => { try { track.detach(el) } catch { /* element gone */ } } // detach ≠ stop
  }, [track]))

  return (
    <Modal open onClose={onClose} title="Camera preview" description="Preview your camera locally — nothing is sent to the meeting." size="sm">
      <div className="overflow-hidden rounded-xl bg-black" style={{ aspectRatio: '16 / 9' }}>
        {track ? (
          <video ref={videoRef} autoPlay muted playsInline className="h-full w-full -scale-x-100 object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-[var(--c-fg-muted)]">
            <VideoOff className="h-8 w-8" />
            <p className="text-[13px]">Turn on your camera to preview it.</p>
          </div>
        )}
      </div>
    </Modal>
  )
}
