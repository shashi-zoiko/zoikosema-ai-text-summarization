import { VideoPresets } from 'livekit-client'

/**
 * Camera video-quality policy for Zoiko Sema.
 *
 * The desktop camera used to be hard-capped at 720p. This module lets capable
 * machines/networks publish Full HD (1080p) while automatically falling back to
 * 720p on weak hardware or constrained networks. The browser can still downgrade
 * FURTHER on its own, because every resolution is handed to getUserMedia as
 * `ideal` (never `exact`) — an SD-only webcam is therefore never over-constrained,
 * it simply delivers whatever it can.
 *
 * Nothing here is user-agent sniffing: the decision is driven by real capability
 * signals (CPU cores, device memory, the Network Information API). Mobile is not
 * special-cased — a strong phone gets HD, a weak one gets 720p, exactly like a
 * laptop. Because the fallback ladder is identical to the previous hard-coded
 * one, mobile never regresses below today's 720p behaviour.
 */

// Coarse hardware/network read. Every input is optional and not universally
// supported, so each branch defaults to "assume capable" — we'd rather attempt
// HD and let WebRTC adapt down than needlessly cap a good device.
export function getHardwareProfile() {
  const nav = typeof navigator !== 'undefined' ? navigator : {}
  const cores = typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 8
  const memory = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : 8
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection || null
  const saveData = !!conn?.saveData
  const effectiveType = conn?.effectiveType || '4g'
  const downlink = typeof conn?.downlink === 'number' ? conn.downlink : null

  const weakCpu = cores <= 4 || memory <= 4
  const poorNetwork =
    saveData ||
    effectiveType === 'slow-2g' || effectiveType === '2g' || effectiveType === '3g' ||
    (downlink !== null && downlink < 2)

  return { cores, memory, saveData, effectiveType, downlink, weakCpu, poorNetwork }
}

/** True when this device/network should attempt Full-HD (1080p) camera capture. */
export function hdCameraAllowed(profile = getHardwareProfile()) {
  return !profile.weakCpu && !profile.poorNetwork
}

/**
 * The camera capture + publish policy for this session, chosen once at join.
 * `hd` → 1080p ladder; otherwise the classic 720p ladder (byte-for-byte the old
 * behaviour, so weak devices act exactly as they used to).
 */
export function getCameraProfile(profile = getHardwareProfile()) {
  if (hdCameraAllowed(profile)) {
    return {
      hd: true,
      captureResolution: VideoPresets.h1080.resolution, // 1920×1080@30 (ideal)
      videoEncoding: VideoPresets.h1080.encoding,        // ~3–5 Mbps top layer
      // Drop the tiny 180p rung, add a 1080p rung: h360 / h720 / h1080.
      simulcastLayers: [VideoPresets.h360, VideoPresets.h720, VideoPresets.h1080],
    }
  }
  return {
    hd: false,
    captureResolution: VideoPresets.h720.resolution,     // 1280×720@30 (ideal)
    videoEncoding: VideoPresets.h720.encoding,           // ~1.7 Mbps top layer
    simulcastLayers: [VideoPresets.h180, VideoPresets.h360, VideoPresets.h720],
  }
}

/**
 * Read the camera's ACTUAL delivered format after the track starts. Never trust
 * the requested resolution — a webcam asked for 1080p may only produce 720p (or
 * 640×480), and honest reporting means surfacing the truth, not a fake "HD"
 * badge. Accepts a LiveKit LocalTrack, a MediaStreamTrack, or a publication.
 */
export function readCameraCapability(trackLike) {
  const mst =
    trackLike?.mediaStreamTrack ||
    trackLike?.track?.mediaStreamTrack ||
    (typeof trackLike?.getSettings === 'function' ? trackLike : null)
  if (!mst || typeof mst.getSettings !== 'function') return null

  let settings = {}
  try { settings = mst.getSettings() || {} } catch { settings = {} }
  let capabilities = null
  try {
    capabilities = typeof mst.getCapabilities === 'function' ? mst.getCapabilities() : null
  } catch { capabilities = null }

  const width = settings.width || null
  const height = settings.height || null
  const frameRate = settings.frameRate ? Math.round(settings.frameRate) : null
  const tier =
    !height ? 'unknown'
      : height >= 1080 ? '1080p'
        : height >= 720 ? '720p'
          : height >= 480 ? '480p'
            : 'low'

  return {
    width,
    height,
    frameRate,
    tier,
    deviceId: settings.deviceId || null,
    // What the HARDWARE can do (from getCapabilities) — lets us tell a hardware
    // ceiling (webcam maxes at 720p) apart from a runtime downgrade.
    maxWidth: capabilities?.width?.max || null,
    maxHeight: capabilities?.height?.max || null,
    maxFrameRate: capabilities?.frameRate?.max ? Math.round(capabilities.frameRate.max) : null,
  }
}
