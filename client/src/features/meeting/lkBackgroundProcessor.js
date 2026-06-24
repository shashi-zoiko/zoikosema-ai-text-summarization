import { BackgroundProcessor } from './backgroundEngine.js'

/**
 * Adapts our MediaPipe {@link BackgroundProcessor} (the same engine the mesh
 * room uses) to LiveKit's `TrackProcessor` interface, so a blurred / replaced
 * camera publishes natively through LiveKit — simulcast, dynacast and adaptive
 * stream all keep working on the processed track. No extra dependency and no
 * CDN fetch: the wasm + selfie model are the self-hosted ones under
 * /public/mediapipe.
 *
 * LiveKit calls init({ track }) with the RAW camera MediaStreamTrack and then
 * publishes `this.processedTrack`. `updateEffect` swaps blur↔image↔radius live
 * without re-initialising the (expensive) segmenter.
 */
export class LkBackgroundProcessor {
  constructor(effect) {
    this.name = 'zoiko-virtual-background'
    this.effect = effect || { type: 'none' }
    this.engine = new BackgroundProcessor()
    this.processedTrack = undefined
  }

  async init(opts) {
    this.engine.setEffect(this.effect)
    this.processedTrack = await this.engine.start(opts.track)
  }

  // Called by LiveKit when the underlying camera track changes (device switch).
  async restart(opts) {
    this.engine.setEffect(this.effect)
    this.processedTrack = await this.engine.start(opts.track)
  }

  async destroy() {
    this.engine.dispose()
    this.processedTrack = undefined
  }

  /** Change blur/image effect in place — cheap, reuses the running pipeline. */
  updateEffect(effect) {
    this.effect = effect || { type: 'none' }
    this.engine.setEffect(this.effect)
  }
}
