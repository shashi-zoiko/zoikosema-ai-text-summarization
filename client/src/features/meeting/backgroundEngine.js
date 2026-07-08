import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision'

/**
 * Virtual-background engine — Google Meet / Teams style camera background
 * blur + replacement, running entirely client-side.
 *
 * Pipeline (per camera frame):
 *   raw camera track → hidden <video> → MediaPipe selfie ImageSegmenter
 *   → per-pixel foreground confidence mask → canvas compositing
 *   (keep the person, blur or swap everything behind them)
 *   → canvas.captureStream() → a processed MediaStreamTrack
 *
 * MeetRoom feeds that processed track to every peer's video sender (via
 * replaceTrack) and to the local self-preview, so it's completely transparent
 * to the WebRTC layer — it just sees a different video track.
 *
 * Assets are self-hosted under /public/mediapipe (wasm runtime + the
 * float16 selfie_segmenter model) so the effect works offline (Electron) and
 * isn't subject to a CDN being reachable / a CSP blocking it.
 *
 * The MediaPipe runtime + model are heavy (~1-2s to init, a few MB of wasm),
 * so the segmenter is created lazily on first use and shared across the
 * processor's lifetime.
 */

// Where the wasm runtime + model live. BASE_URL respects the Vite `base`
// (the Electron build ships with base './'), so this resolves correctly
// whether served from / or a sub-path or the file:// app bundle.
const ASSET_BASE = `${import.meta.env.BASE_URL || '/'}mediapipe`

let _segmenterPromise = null

// Create (once) and reuse the ImageSegmenter. Try the GPU delegate first —
// it's dramatically faster — and fall back to CPU if WebGL/GPU init throws
// (headless GPUs, locked-down drivers, some VMs).
async function createSegmenter() {
  const fileset = await FilesetResolver.forVisionTasks(`${ASSET_BASE}/wasm`)
  const baseOptions = { modelAssetPath: `${ASSET_BASE}/selfie_segmenter.tflite` }
  const common = {
    runningMode: 'VIDEO',
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  }
  try {
    return await ImageSegmenter.createFromOptions(fileset, {
      ...common,
      baseOptions: { ...baseOptions, delegate: 'GPU' },
    })
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[bg] GPU delegate failed, falling back to CPU', e)
    return await ImageSegmenter.createFromOptions(fileset, {
      ...common,
      baseOptions: { ...baseOptions, delegate: 'CPU' },
    })
  }
}

function getSegmenter() {
  if (!_segmenterPromise) {
    _segmenterPromise = createSegmenter().catch((e) => {
      // Reset so a later attempt can retry instead of being stuck on a
      // rejected promise forever.
      _segmenterPromise = null
      throw e
    })
  }
  return _segmenterPromise
}

/** Quick capability probe so the UI can hide/disable the feature gracefully. */
export function backgroundEffectsSupported() {
  return (
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    typeof MediaStream !== 'undefined'
  )
}

export class BackgroundProcessor {
  constructor() {
    // Hidden <video> plays the RAW camera track; it's the segmenter input
    // and the source pixels for compositing. Muted + playsInline so mobile
    // browsers actually start it without a user gesture.
    this.video = document.createElement('video')
    this.video.muted = true
    this.video.playsInline = true
    this.video.autoplay = true

    // Output canvas (what we captureStream from) and a tiny mask canvas the
    // model's low-res confidence mask is rasterised into before we scale it up.
    this.canvas = document.createElement('canvas')
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false })
    this.maskCanvas = document.createElement('canvas')
    this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true })

    this.segmenter = null
    this._segLoading = false
    this.effect = { type: 'none' }
    this.bgImage = null
    this.outputStream = null
    this.running = false
    this.rafId = null
    this.usingRVFC = false
    this._lastTs = 0
    this._sourceTrack = null
    this._onError = null
    this._polarityChecked = false
    this.invert = false
    this._maskEma = null
    this._blurCanvas = null
    this._blurCtx = null
  }

  /** Register a callback fired if the pipeline dies after start (best-effort). */
  onError(cb) { this._onError = cb }

  /**
   * Begin processing a raw camera track. Returns the processed video track
   * once the first frame has been composited. Safe to call again with a new
   * track (e.g. after a device switch) — it re-binds the source.
   */
  async start(track, fps = 30) {
    // New camera source → re-detect mask polarity and drop the smoothing
    // history (different framing/device).
    if (track !== this._sourceTrack) { this._polarityChecked = false; this._maskEma = null }
    this._sourceTrack = track
    this.video.srcObject = new MediaStream([track])
    await this.video.play().catch(() => {})

    // Wait for real dimensions before sizing the canvases.
    if (!this.video.videoWidth) {
      await new Promise((res) => {
        const done = () => { this.video.removeEventListener('loadeddata', done); res() }
        this.video.addEventListener('loadeddata', done)
        setTimeout(res, 1500)
      })
    }
    const w = this.video.videoWidth || 1280
    const h = this.video.videoHeight || 720
    this.canvas.width = w
    this.canvas.height = h

    // Only the blur/image backgrounds need MediaPipe. A colour-grade filter (or
    // a later switch to one) skips loading the heavy segmenter entirely.
    if (this._needsSegmenter() && !this.segmenter) this.segmenter = await getSegmenter()

    if (!this.outputStream) {
      this.outputStream = this.canvas.captureStream(fps)
      const outTrack = this.outputStream.getVideoTracks()[0]
      try { outTrack.contentHint = 'motion' } catch {}
    }

    if (!this.running) {
      this.running = true
      this._loop()
    }
    return this.outputStream.getVideoTracks()[0]
  }

  get outputTrack() {
    return this.outputStream ? this.outputStream.getVideoTracks()[0] : null
  }

  /**
   * Set the active effect.
   *   { type: 'none' }                       → passthrough (caller should use raw track)
   *   { type: 'blur', radius: <px> }         → blur the background
   *   { type: 'image', src: <url>, image }   → replace the background
   */
  setEffect(effect) {
    this.effect = effect || { type: 'none' }
    if (this.effect.type === 'image' && this.effect.src) {
      this._loadImage(this.effect.src)
    } else {
      this.bgImage = null
    }
    // Switched to a background that needs the segmenter but it isn't loaded yet
    // (e.g. we started on a cheap filter) — kick off the load in the background.
    if (this._needsSegmenter()) this._ensureSegmenter()
  }

  /** True when the active effect requires MediaPipe segmentation. */
  _needsSegmenter() {
    const t = this.effect?.type
    return t === 'blur' || t === 'image'
  }

  /** Lazily load the shared segmenter without blocking the render loop. */
  _ensureSegmenter() {
    if (this.segmenter || this._segLoading) return
    this._segLoading = true
    getSegmenter()
      .then((s) => { this.segmenter = s })
      .catch(() => {})
      .finally(() => { this._segLoading = false })
  }

  _loadImage(src) {
    if (this._imgSrc === src && this.bgImage) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { this.bgImage = img; this._imgSrc = src }
    img.onerror = () => { this.bgImage = null }
    img.src = src
  }

  _loop() {
    if (!this.running) return
    const render = () => {
      if (!this.running) return
      this._renderFrame()
    }
    // requestVideoFrameCallback syncs work to actual decoded frames (no wasted
    // segmentations on a paused/static feed) — far smoother than a rAF poll.
    if (typeof this.video.requestVideoFrameCallback === 'function') {
      this.usingRVFC = true
      const step = () => {
        if (!this.running) return
        render()
        this.rafId = this.video.requestVideoFrameCallback(step)
      }
      this.rafId = this.video.requestVideoFrameCallback(step)
    } else {
      const step = () => {
        if (!this.running) return
        render()
        this.rafId = requestAnimationFrame(step)
      }
      this.rafId = requestAnimationFrame(step)
    }
  }

  _renderFrame() {
    const v = this.video
    if (!v.videoWidth || v.readyState < 2) return

    // Colour-grade filter — no segmentation, just draw the raw frame through a
    // CSS filter. Cheap; runs regardless of participant count.
    if (this.effect.type === 'filter') {
      this._drawFiltered(this.effect.css)
      return
    }

    // A background that needs the segmenter, but it isn't ready yet — show the
    // raw camera (never freeze) while it loads in the background.
    if (!this.segmenter) {
      this.ctx.filter = 'none'
      this.ctx.globalCompositeOperation = 'source-over'
      this.ctx.drawImage(v, 0, 0, this.canvas.width, this.canvas.height)
      this._ensureSegmenter()
      return
    }

    // Monotonic, strictly-increasing timestamp is required by VIDEO mode.
    let ts = performance.now()
    if (ts <= this._lastTs) ts = this._lastTs + 1
    this._lastTs = ts

    try {
      this.segmenter.segmentForVideo(v, ts, (result) => {
        try { this._composite(result) } finally { result?.close?.() }
      })
    } catch (e) {
      if (import.meta.env.DEV) console.error('[bg] segmentForVideo failed', e)
      if (this._onError) { this._onError(e); this._onError = null }
    }
  }

  _composite(result) {
    const ctx = this.ctx
    const w = this.canvas.width
    const h = this.canvas.height
    const mask = result?.confidenceMasks?.[0]
    if (!mask) {
      // No mask this frame — just show the raw camera so we never freeze.
      ctx.globalCompositeOperation = 'source-over'
      ctx.filter = 'none'
      ctx.drawImage(this.video, 0, 0, w, h)
      return
    }

    const mw = mask.width
    const mh = mask.height
    const conf = mask.getAsFloat32Array()

    // Auto-detect mask polarity once. The selfie model's confidence mask is
    // foreground (person) probability, but rather than hard-code that
    // assumption we verify it: on a video call the person sits centre-frame
    // and the background is at the corners, so if the centre reads LOWER
    // confidence than the corners the mask is inverted and we flip it. Only
    // flips on a clear difference so an off-centre / frame-filling subject
    // can't trigger a false inversion.
    if (!this._polarityChecked) {
      this._polarityChecked = true
      const at = (x, y) => conf[y * mw + x]
      const cx = mw >> 1
      const cy = mh >> 1
      const bw = Math.max(1, mw >> 3)
      const bh = Math.max(1, mh >> 3)
      let center = 0
      let n = 0
      for (let y = cy - bh; y < cy + bh; y++) {
        for (let x = cx - bw; x < cx + bw; x++) { center += at(x, y); n++ }
      }
      center /= n || 1
      const corner = (conf[0] + conf[mw - 1] + conf[(mh - 1) * mw] + conf[mh * mw - 1]) / 4
      this.invert = center < corner - 0.2
    }
    const invert = this.invert
    const N = conf.length

    // Temporal smoothing (exponential moving average). The raw per-frame mask
    // jitters along the silhouette — that "boiling edge" is the single biggest
    // tell that a background is fake. Blending each frame with the running
    // average steadies the edge the way Google Meet does, at near-zero cost.
    // EMA holds the foreground probability (post-polarity-correction).
    if (!this._maskEma || this._maskEma.length !== N) {
      this._maskEma = new Float32Array(N)
      for (let i = 0; i < N; i++) this._maskEma[i] = invert ? 1 - conf[i] : conf[i]
    }
    const ema = this._maskEma
    // History weight: enough to steady the edge, low enough that the mask
    // doesn't lag behind movement and leave ghost holes in the body.
    const A = 0.45
    const B = 1 - A
    for (let i = 0; i < N; i++) {
      const f = invert ? 1 - conf[i] : conf[i]
      ema[i] = ema[i] * A + f * B
    }

    // Rasterise the smoothed mask into a small RGBA canvas: white where the
    // person is, transparent on the background.
    if (this.maskCanvas.width !== mw || this.maskCanvas.height !== mh) {
      this.maskCanvas.width = mw
      this.maskCanvas.height = mh
    }
    const imgData = this.maskCtx.createImageData(mw, mh)
    const px = imgData.data
    // Alpha ramp tuned so the body is SOLID and only the edge feathers:
    //   - HI is low (0.5) so any pixel the model is even moderately confident
    //     about becomes fully opaque — this fills the translucent "holes" in
    //     the torso/face that let the background punch through.
    //   - LO..HI is a short feather for a soft, non-blocky silhouette edge.
    // The remaining smoothing/anti-aliasing of the low-res mask is done by the
    // upscale blur below, not by a wide ramp here (a wide ramp = milky halo).
    const LO = 0.35
    const HI = 0.5
    const SPAN = 255 / (HI - LO)
    for (let i = 0; i < N; i++) {
      const a = ema[i]
      const j = i * 4
      px[j] = 255
      px[j + 1] = 255
      px[j + 2] = 255
      px[j + 3] = a <= LO ? 0 : a >= HI ? 255 : Math.round((a - LO) * SPAN)
    }
    this.maskCtx.putImageData(imgData, 0, 0)

    ctx.save()
    ctx.clearRect(0, 0, w, h)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    // 1. Lay down the upscaled person mask, feathered. The model mask is only
    //    256² — scaling it to 720p+ with a hard edge looks blocky/staircased,
    //    which over a flat background (e.g. the logo card) reads as jagged
    //    chunks. A resolution-scaled gaussian smooths the upscale into a clean
    //    soft silhouette. Bilinear upscale alone isn't enough; the blur is.
    const feather = Math.max(3, Math.round(w / 230))
    ctx.filter = `blur(${feather}px)`
    ctx.drawImage(this.maskCanvas, 0, 0, w, h)
    ctx.filter = 'none'

    // 2. Keep the camera pixels only where the mask is opaque (the person).
    ctx.globalCompositeOperation = 'source-in'
    ctx.drawImage(this.video, 0, 0, w, h)

    // 3. Paint the chosen background BEHIND the person.
    ctx.globalCompositeOperation = 'destination-over'
    if (this.effect.type === 'blur') {
      this._drawBlurredBg(this.effect.radius || 12, w, h)
    } else if (this.effect.type === 'image' && this.bgImage) {
      this._drawCover(this.bgImage, w, h)
    } else {
      // Effect set to image but not loaded yet → fall back to a light blur so
      // there's never an empty/transparent background flash.
      this._drawBlurredBg(10, w, h)
    }

    ctx.globalCompositeOperation = 'source-over'
    ctx.restore()
    mask.close?.()
  }

  // Fast background blur: downscale the camera into a small offscreen canvas,
  // then draw it back scaled up with bilinear smoothing. Downscale-then-upscale
  // is an order of magnitude cheaper than a full-resolution CSS `blur()` every
  // frame (which is what made the effect feel sluggish), and the result looks
  // the same. A small residual `blur()` removes any upscale blockiness.
  _drawBlurredBg(radius, w, h) {
    const ctx = this.ctx
    // Heavier radius → smaller intermediate → softer blur. Clamped so we never
    // go below a few px of detail.
    const factor = Math.max(2, Math.min(10, Math.round(radius / 2.5)))
    const sw = Math.max(8, Math.round(w / factor))
    const sh = Math.max(8, Math.round(h / factor))
    if (!this._blurCanvas) {
      this._blurCanvas = document.createElement('canvas')
      this._blurCtx = this._blurCanvas.getContext('2d')
    }
    if (this._blurCanvas.width !== sw || this._blurCanvas.height !== sh) {
      this._blurCanvas.width = sw
      this._blurCanvas.height = sh
    }
    const bc = this._blurCtx
    bc.imageSmoothingEnabled = true
    bc.drawImage(this.video, 0, 0, sw, sh)
    // Slight overscan so edges stay covered after the soft upscale.
    const o = Math.round(w * 0.04)
    ctx.filter = 'blur(2px)'
    ctx.drawImage(this._blurCanvas, -o, -o, w + o * 2, h + o * 2)
    ctx.filter = 'none'
  }

  // Full-frame colour grade: draw the raw camera through a CSS filter. Both
  // the person and the background are graded (like Google Meet's Filters tab).
  _drawFiltered(css) {
    const ctx = this.ctx
    const w = this.canvas.width
    const h = this.canvas.height
    ctx.save()
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, w, h)
    ctx.filter = css || 'none'
    ctx.drawImage(this.video, 0, 0, w, h)
    ctx.filter = 'none'
    ctx.restore()
  }

  // Cover-fit (object-fit: cover) the background image onto the canvas.
  _drawCover(img, w, h) {
    const iw = img.naturalWidth || img.width
    const ih = img.naturalHeight || img.height
    if (!iw || !ih) return
    const scale = Math.max(w / iw, h / ih)
    const dw = iw * scale
    const dh = ih * scale
    this.ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
  }

  /** Stop the render loop and release the output stream (keeps the segmenter). */
  stop() {
    this.running = false
    if (this.rafId != null) {
      if (this.usingRVFC && typeof this.video.cancelVideoFrameCallback === 'function') {
        try { this.video.cancelVideoFrameCallback(this.rafId) } catch {}
      } else {
        cancelAnimationFrame(this.rafId)
      }
      this.rafId = null
    }
    if (this.outputStream) {
      this.outputStream.getTracks().forEach((t) => { try { t.stop() } catch {} })
      this.outputStream = null
    }
    try { this.video.pause() } catch {}
    this.video.srcObject = null
    this._sourceTrack = null
    this._lastTs = 0
  }

  /** Full teardown — also closes the shared segmenter. Call on unmount. */
  dispose() {
    this.stop()
    if (this.segmenter) {
      try { this.segmenter.close() } catch {}
      this.segmenter = null
      // Reset the module cache so a remounted room re-creates a fresh
      // segmenter instead of reusing this now-closed one.
      _segmenterPromise = null
    }
    this.bgImage = null
  }
}
